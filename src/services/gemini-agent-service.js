import { GEMINI_LIVE_MODEL, GEMINI_LIVE_API_URL, buildGeminiSystemPrompt } from '../utils/constants.js';

export class GeminiLiveAPIClient {
  constructor() {
    this.ws = null;
    this.inputAudioContext = null;
    this.outputAudioContext = null;
    this.mediaStream = null;
    this.inputWorklet = null;
    this.outputWorklet = null;
    this.micSource = null;
    this.isConnected = false;

    this.onText = null;
    this.onStateChange = null;
    this.playbackRate = 1.0;
    
    // PTT State
    this.isPttMode = false;
    this.isPttRecording = false;
    this.pttBuffer = [];
  }

  setInteractionMode(mode) {
    this.isPttMode = (mode === 'ptt');
  }

  setMicEnabled(enabled) {
    this.micEnabled = enabled;
  }

  setAudioEnabled(enabled) {
    this.audioEnabled = enabled;
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
  }

  async connect(options) {
    const { geminiKey, level, topic, voicePreference, feedbackEnabled, feedbackLang, audioEnabled, micEnabled, voiceSpeed, onText, onStateChange, onAgentAudioReady } = options;
    this.onText = onText;
    this.onStateChange = onStateChange;
    this.onAgentAudioReady = onAgentAudioReady;
    this.audioEnabled = audioEnabled !== undefined ? audioEnabled : true;
    this.micEnabled = micEnabled !== undefined ? micEnabled : true;
    this.playbackRate = voiceSpeed || 1.0;
    this.autoDisconnectTimeout = options.autoDisconnectTimeout || 60;
    this.inactivityTimer = null;
    this.currentTurnAudioChunks = [];

    this._updateState('connecting');

    // Create AudioContexts synchronously during the user gesture to unlock audio playback.
    // Let the browser choose its native sample rate to avoid hardware compatibility issues.
    if (!this.outputAudioContext) {
      this.outputAudioContext = new AudioContext();
    }
    if (!this.inputAudioContext) {
      this.inputAudioContext = new AudioContext({ sampleRate: 16000 }); // We still need 16kHz for input mic if possible
    }

    const url = `${GEMINI_LIVE_API_URL}?key=${geminiKey}`;
    this.ws = new WebSocket(url);

    this.ws.onopen = async () => {
      // 1. Send Setup Message
      const prompt = buildGeminiSystemPrompt(level, topic, feedbackEnabled, feedbackLang);
      
      let voiceName = 'Kore';
      if (['Kore', 'Aoede', 'Puck', 'Charon', 'Fenrir'].includes(voicePreference)) {
        voiceName = voicePreference;
      } else if (voicePreference === 'male') {
        voiceName = 'Puck';
      }

      const setupMessage = {
        setup: {
          model: `models/${GEMINI_LIVE_MODEL}`,
          systemInstruction: {
            parts: [{ text: prompt }]
          },
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName: voiceName
                }
              }
            }
          }
        }
      };

      this.ws.send(JSON.stringify(setupMessage));

      // 2. Setup Audio Processing
      await this._setupAudio();

      this.isConnected = true;
      this._updateState('connected');
      
      // Start User Speech Recognition for UI Transcript
      this._startUserTranscription();
    };

    this.ws.onmessage = (event) => {
      this._handleServerMessage(event.data);
    };

    this.ws.onerror = (err) => {
      console.error('[GeminiLive] WebSocket error', err);
      this._updateState('error', 'Bağlantı hatası');
    };

    this.ws.onclose = (event) => {
      console.warn(`[GeminiLive] WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
      const isError = event.code !== 1000 && event.code !== 1005;
      if (isError) {
        this._updateState('error', `Bağlantı kapandı (${event.code}): ${event.reason || 'Bilinmeyen hata'}`);
      }
      this.disconnect();
    };
  }

  _startUserTranscription() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    
    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'de-DE';
    this.recognition.continuous = true;
    this.recognition.interimResults = true; // Changed to true for interim results
    
    this.recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      
      if (finalTranscript.trim().length > 0) {
         this._resetInactivityTimer();
         this._updateState('user_text', finalTranscript);
      } else if (interimTranscript.trim().length > 0) {
         this._resetInactivityTimer();
         this._updateState('user_text_interim', interimTranscript);
      }
    };
    
    this.recognition.onerror = () => {};
    this.recognition.onend = () => {
      if (this.isConnected) {
        try { this.recognition.start(); } catch (e) {}
      }
    };
    
    try { this.recognition.start(); } catch (e) {}
  }

  async _setupAudio() {
    // Force resume audio context if suspended
    if (this.outputAudioContext.state === 'suspended') {
      await this.outputAudioContext.resume();
      console.log("[GeminiLive] AudioContext resumed, state:", this.outputAudioContext.state);
    }
    
    // Initialize playback scheduling
    this.nextPlaybackTime = this.outputAudioContext.currentTime;

    // Play a tiny debug beep to verify audio context is unmuted
    try {
      const osc = this.outputAudioContext.createOscillator();
      const gain = this.outputAudioContext.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.outputAudioContext.currentTime);
      gain.gain.setValueAtTime(0.1, this.outputAudioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.outputAudioContext.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(this.outputAudioContext.destination);
      osc.start();
      osc.stop(this.outputAudioContext.currentTime + 0.1);
    } catch (e) {}

    // ---- INPUT (Microphone) - 16kHz ----
    await this.inputAudioContext.audioWorklet.addModule('/pcm-processor.js');
    this.inputWorklet = new AudioWorkletNode(this.inputAudioContext, 'pcm-processor');
    
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }});
    
    this.micSource = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
    this.micSource.connect(this.inputWorklet);
    
    // In Chromium browsers, Worklets may be suspended if not connected to the destination.
    // We connect it through a silent GainNode to prevent echo but keep it active.
    const silentGain = this.inputAudioContext.createGain();
    silentGain.gain.value = 0;
    this.inputWorklet.connect(silentGain);
    silentGain.connect(this.inputAudioContext.destination);

    // Handle audio chunks from mic
    this.inputWorklet.port.onmessage = (event) => {
      // If mic is muted, do not send audio to server.
      if (!this.micEnabled) return;

      if (this.isConnected && this.isSetupComplete && this.ws.readyState === WebSocket.OPEN) {
        
        const int16Array = event.data;
        
        let maxVol = 0;
        for (let i = 0; i < int16Array.length; i+=10) {
           if (Math.abs(int16Array[i]) > maxVol) maxVol = Math.abs(int16Array[i]);
        }
        // Removed volume-based inactivity timer reset to prevent background noise from keeping the session alive

        if (this.isPttMode) {
          if (this.isPttRecording) {
            this.pttBuffer.push(int16Array);
          }
        } else {
          // Live mode: Send continuously
          const base64Audio = this._int16ArrayToBase64(int16Array);
          const message = {
            realtimeInput: {
              audio: {
                mimeType: "audio/pcm;rate=16000",
                data: base64Audio
              }
            }
          };
          this.ws.send(JSON.stringify(message));
        }
      }
    };
  }

  startPttRecording() {
    if (!this.isConnected || this.ws.readyState !== WebSocket.OPEN) return;
    this.isPttRecording = true;
    this.pttBuffer = [];
    this._updateState('ptt_start');
  }

  stopPttRecording() {
    if (!this.isPttRecording) return;
    this.isPttRecording = false;
    this._updateState('ptt_stop');
    
    if (this.pttBuffer.length > 0) {
      let totalLength = 0;
      for (const arr of this.pttBuffer) totalLength += arr.length;
      
      const combined = new Int16Array(totalLength);
      let offset = 0;
      for (const arr of this.pttBuffer) {
        combined.set(arr, offset);
        offset += arr.length;
      }
      
      const base64Audio = this._int16ArrayToBase64(combined);
      const message = {
        realtimeInput: {
          audio: { mimeType: "audio/pcm;rate=16000", data: base64Audio }
        }
      };
      
      if (this.ws.readyState === WebSocket.OPEN) {
        // Send the buffered audio
        this.ws.send(JSON.stringify(message));
        // Immediately end the turn
        this.ws.send(JSON.stringify({ clientContent: { turnComplete: true } }));
      }
    }
    this.pttBuffer = [];
  }

  _handleServerMessage(data) {
    let msg;
    if (data instanceof Blob) {
      // Just in case it sends blobs, read it
      data.text().then(text => this._handleServerMessage(text));
      return;
    }
    
    try {
      msg = JSON.parse(data);
    } catch (e) {
      return;
    }

    if (msg.setupComplete) {
      this.isSetupComplete = true;
      this._updateState('connected', 'İlk veri alındı');
      this._resetInactivityTimer();
      
      // Ensure audio contexts are running
      if (this.outputAudioContext && this.outputAudioContext.state === 'suspended') {
        this.outputAudioContext.resume();
      }
      if (this.inputAudioContext && this.inputAudioContext.state === 'suspended') {
        this.inputAudioContext.resume();
      }
      return;
    }

    if (msg.error) {
      console.error("[GeminiLive] Server sent error:", msg.error);
      this._updateState('error', `Sunucu Hatası: ${msg.error.message || JSON.stringify(msg.error)}`);
      return;
    }

      if (msg.serverContent) {
        this._resetInactivityTimer();
        
        // --- 1) Metin (Transcription) Çıkarımı ---
        if (msg.serverContent.outputTranscription && msg.serverContent.outputTranscription.text) {
           if (this.onText) {
             this.onText(msg.serverContent.outputTranscription.text);
           }
        }

        // --- 2) Ses (Audio) Çıkarımı ---
        if (msg.serverContent.modelTurn && msg.serverContent.modelTurn.parts) {
          const parts = msg.serverContent.modelTurn.parts;
          
          let hasAudio = false;
          for (const part of parts) {
            // Handle Audio
            if (part.inlineData && part.inlineData.mimeType.startsWith('audio/pcm')) {
              hasAudio = true;
              try {
                const float32Data = this._base64ToFloat32Array(part.inlineData.data);
                this.currentTurnAudioChunks.push(float32Data);
                this._schedulePlayback(float32Data);
              } catch (err) {
                console.error("[GeminiLive] Audio parsing error:", err);
              }
            }
            // Handle legacy text just in case
            if (part.text && this.onText) {
              this.onText(part.text);
            }
          }
          
          if (hasAudio) {
            // Mute SpeechRecognition while agent is speaking to prevent phantom echo transcripts
            if (this.recognition && !this._isAgentSpeaking) {
              this._isAgentSpeaking = true;
              try { this.recognition.abort(); } catch(e) {}
            }
          }
        }

        // --- 3) Turn Complete ---
        if (msg.serverContent.turnComplete) {
          this._isAgentSpeaking = false;
          
          if (this.currentTurnAudioChunks.length > 0) {
            const totalLength = this.currentTurnAudioChunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const merged = new Float32Array(totalLength);
            let offset = 0;
            for (const chunk of this.currentTurnAudioChunks) {
              merged.set(chunk, offset);
              offset += chunk.length;
            }
            
            const audioId = `audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            if (this.onAgentAudioReady) {
              this.onAgentAudioReady(audioId, merged);
            }
            
            this.currentTurnAudioChunks = [];
          }

          this._updateState('agent_turn_complete');

          // Resume SpeechRecognition now that agent has finished
          if (this.recognition && this.isConnected) {
            try { this.recognition.start(); } catch(e) {}
          }
        }
      }
  }

  _schedulePlayback(float32Data) {
    if (!this.outputAudioContext || float32Data.length === 0 || !this.audioEnabled) return;
    
    // Debug amplitude
    let maxAmp = 0;
    for (let i = 0; i < float32Data.length; i++) {
      if (Math.abs(float32Data[i]) > maxAmp) maxAmp = Math.abs(float32Data[i]);
    }
    
    // YENİ: Sadece genlik(amplitude) 0 ise (SESSİZLİK) ekranda uyarı ver, yoksa ekranı mesaj yağmuruna tutma
    if (maxAmp === 0) {
        this._updateState('debug', 'Uyarı: Sunucudan SESSİZ ses paketi geldi!');
    }
    // Eğer maxAmp 0'dan büyükse, gerçekten ses geliyordur. Hoparlör çalmıyorsa donanımsaldır.
    if (this._firstAudioReceived !== true && maxAmp > 0) {
        this._firstAudioReceived = true;
        this._updateState('debug', `İlk geçerli ses paketi başarıyla işlendi (Şiddet: ${maxAmp.toFixed(3)})`);
    }
    
    // Create an AudioBuffer (1 channel, sample length, 24000 Hz)
    // If the browser's native AudioContext is 48000Hz, it will automatically resample from 24000Hz.
    const audioBuffer = this.outputAudioContext.createBuffer(1, float32Data.length, 24000);
    audioBuffer.getChannelData(0).set(float32Data);
    
    const source = this.outputAudioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = this.playbackRate;
    source.connect(this.outputAudioContext.destination);
    
    const currentTime = this.outputAudioContext.currentTime;
    
    // If we've fallen behind, reset the next playback time to current time
    if (this.nextPlaybackTime < currentTime) {
      this.nextPlaybackTime = currentTime;
    }
    
    source.start(this.nextPlaybackTime);
    
    // Calculate the actual duration it will take to play based on playbackRate
    const actualDuration = audioBuffer.duration / this.playbackRate;
    this.nextPlaybackTime += actualDuration;
  }

  sendText(text) {
    if (!this.isConnected || !this.isSetupComplete || this.ws.readyState !== WebSocket.OPEN) return;

    this._resetInactivityTimer();

    // Send text as realtimeInput as required by newer API versions (3.1+)
    const realtimeMessage = {
      clientContent: {
        turns: [{
          role: "user",
          parts: [{ text: text }]
        }],
        turnComplete: true
      }
    };
    
    // Live API 3.1+ prefers clientContent for text, but we'll also try a clientContent turn. 
    this.ws.send(JSON.stringify(realtimeMessage));
  }

  disconnect() {
    this.isConnected = false;
    this._updateState('disconnected');
    
    if (this.recognition) {
      try { this.recognition.stop(); } catch(e) {}
      this.recognition = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    if (this.inputAudioContext) {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    if (this.outputAudioContext) {
      this.outputAudioContext.close();
      this.outputAudioContext = null;
    }
    
    this._clearInactivityTimer();
  }
  
  _resetInactivityTimer() {
    this._clearInactivityTimer();
    if (this.autoDisconnectTimeout > 0) {
      this.inactivityTimer = setTimeout(() => {
        this._updateState('timeout_disconnect', 'Uzun süre işlem yapılmadığı için bağlantı otomatik sonlandırıldı.');
        this.disconnect();
      }, this.autoDisconnectTimeout * 1000);
    }
  }

  _clearInactivityTimer() {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  _updateState(state, error = null) {
    if (this.onStateChange) {
      this.onStateChange(state, error);
    }
  }

  // --- Utils ---

  _int16ArrayToBase64(int16Array) {
    const bytes = new Uint8Array(int16Array.buffer);
    let binary = '';
    // Safe manual string conversion to avoid call stack limits completely
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  _base64ToFloat32Array(base64) {
    const binaryString = atob(base64);
    let len = binaryString.length;
    // Ensure length is even for 16-bit PCM
    if (len % 2 !== 0) {
      len -= 1;
    }
    
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const int16Array = new Int16Array(bytes.buffer, 0, len / 2);
    const float32Array = new Float32Array(int16Array.length);
    for (let i = 0; i < int16Array.length; i++) {
      float32Array[i] = int16Array[i] / 32768.0;
    }
    return float32Array;
  }

  setAudioEnabled(enabled) {
    this.audioEnabled = enabled;
  }

  sendSystemWhisper(text) {
    if (!this.isConnected || !this.isSetupComplete || this.ws.readyState !== WebSocket.OPEN) return;
    const message = {
      clientContent: {
        turns: [{
          role: "user",
          parts: [{ text: `[SİSTEM NOTU: ${text}]` }]
        }],
        turnComplete: false
      }
    };
    this.ws.send(JSON.stringify(message));
  }
}
