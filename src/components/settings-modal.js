// ============================================
// DeutschVoice Agent — Settings Modal Controller
// ============================================

import { loadSettings, saveSettings, clearAllConversations } from '../utils/storage.js';
import { GEMINI_LIVE_MODEL } from '../utils/constants.js';

export class SettingsModal {
  constructor() {
    // Elements
    this.overlay = document.getElementById('settings-modal');
    this.btnOpen = document.getElementById('btn-settings');
    this.btnClose = document.getElementById('btn-close-settings');
    this.btnCancel = document.getElementById('btn-cancel-settings');
    this.btnSave = document.getElementById('btn-save-settings');
    this.btnClearHistory = document.getElementById('btn-clear-history');

    // Input elements
    this.inputs = {
      geminiKey: document.getElementById('input-gemini-key'),
      geminiVoice: document.getElementById('select-gemini-voice'),
      geminiSpeed: document.getElementById('select-gemini-speed'),
      autoDisconnect: document.getElementById('input-auto-disconnect')
    };

    this._onSave = null;
    this._onClearHistory = null;
    this.demoAudioContext = null;
    this.demoSource = null;
    this.isDemoPlaying = false;
    this.btnDemoVoice = document.getElementById('btn-demo-voice');

    this._bindEvents();
    this._loadCurrentSettings();
  }

  set onSave(fn) { this._onSave = fn; }
  set onClearHistory(fn) { this._onClearHistory = fn; }

  _bindEvents() {
    this.btnOpen.addEventListener('click', () => this.open());
    this.btnClose.addEventListener('click', () => this.close());
    this.btnCancel.addEventListener('click', () => this.close());
    this.btnSave.addEventListener('click', () => {
      this._save();
    });

    this.btnClearHistory.addEventListener('click', () => {
      if (confirm('Tüm sohbet geçmişi silinecek. Emin misiniz?')) {
        clearAllConversations();
        if (this._onClearHistory) this._onClearHistory();
        this.close();
      }
    });

    // Sync to Supabase button
    const btnSync = document.getElementById('btn-sync-supabase');
    if (btnSync) {
      btnSync.addEventListener('click', async () => {
        btnSync.disabled = true;
        btnSync.innerHTML = '⏳ Aktarılıyor...';
        try {
          const { migrateLocalDataToSupabase } = await import('../services/supabase-service.js');
          const stats = await migrateLocalDataToSupabase();
          alert(`Aktarım Başarılı!\n\n• ${stats.conversations} sohbet oturumu\n• ${stats.messages} mesaj\n• ${stats.audio} ses kaydı\n• ${stats.words} sözlük kelimesi\n\nSupabase veritabanına aktarıldı.`);
        } catch (e) {
          alert('Aktarım sırasında hata oluştu: ' + e.message);
        } finally {
          btnSync.disabled = false;
          btnSync.innerHTML = '🔄 Tarayıcı Verilerini Şimdi Supabase\'e Aktar';
        }
      });
    }

    // Close on overlay click
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.overlay.classList.contains('open')) {
        this.close();
      }
    });

    if (this.btnDemoVoice) {
      this.btnDemoVoice.addEventListener('click', async () => {
        if (this.isDemoPlaying) {
          if (this.demoSource) {
            try { this.demoSource.stop(); } catch(e) {}
            try { this.demoSource.close(); } catch(e) {}
          }
          this.isDemoPlaying = false;
          this.btnDemoVoice.textContent = '▶️';
          return;
        }

        const apiKey = this.inputs.geminiKey.value.trim() || loadSettings().geminiKey;
        if (!apiKey) {
          alert('Lütfen sesi dinleyebilmek için API anahtarınızı girin.');
          return;
        }

        const voiceName = this.inputs.geminiVoice.value || 'Kore';
        this.isDemoPlaying = true;
        this.btnDemoVoice.textContent = '⏹️';

        try {
          const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${apiKey}`;
          const ws = new WebSocket(wsUrl);
          this.demoSource = ws; // Store ws to allow cancelling

          if (!this.demoAudioContext) this.demoAudioContext = new AudioContext();
          if (this.demoAudioContext.state === 'suspended') await this.demoAudioContext.resume();
          
          let nextPlaybackTime = this.demoAudioContext.currentTime;
          let hasReceivedAudio = false;

          ws.onopen = () => {
            const setupMessage = {
              setup: {
                model: `models/${GEMINI_LIVE_MODEL}`,
                systemInstruction: {
                  parts: [{ text: "Sen bir seslendirme (TTS) motorusun. Görevin, sana gönderilen metinleri hiçbir kelime eklemeden, değiştirmeden ve cevap vermeden doğrudan sesli olarak aynen tekrar etmektir." }]
                },
                generationConfig: {
                  responseModalities: ["AUDIO"],
                  speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voiceName } } }
                }
              }
            };
            ws.send(JSON.stringify(setupMessage));

            const clientContent = {
              clientContent: {
                turns: [{ role: "user", parts: [{ text: "Merhaba, ben senin yeni Almanca pratik asistanınım. Hallo, ich bin dein neuer Deutsch-Übungsassistent." }] }],
                turnComplete: true
              }
            };
            ws.send(JSON.stringify(clientContent));
          };

          ws.onmessage = async (event) => {
            if (event.data instanceof Blob) {
              const text = await event.data.text();
              processMessage(text);
            } else {
              processMessage(event.data);
            }
          };

          const processMessage = async (msgText) => {
            try {
              const data = JSON.parse(msgText);
              if (data.serverContent && data.serverContent.modelTurn) {
                const parts = data.serverContent.modelTurn.parts;
                for (const part of parts) {
                  if (part.inlineData && part.inlineData.mimeType.startsWith('audio/') && part.inlineData.data) {
                    hasReceivedAudio = true;
                    const binaryString = atob(part.inlineData.data);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
                    
                    const int16Array = new Int16Array(bytes.buffer);
                    const float32Array = new Float32Array(int16Array.length);
                    for (let i = 0; i < int16Array.length; i++) float32Array[i] = int16Array[i] / 32768.0;

                    const audioBuffer = this.demoAudioContext.createBuffer(1, float32Array.length, 24000);
                    audioBuffer.getChannelData(0).set(float32Array);

                    const source = this.demoAudioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(this.demoAudioContext.destination);
                    
                    let playTime = nextPlaybackTime;
                    if (playTime < this.demoAudioContext.currentTime) {
                      playTime = this.demoAudioContext.currentTime;
                    }
                    source.start(playTime);
                    nextPlaybackTime = playTime + audioBuffer.duration;
                    
                    // Reset demo state exactly when the scheduled audio finishes playing
                    source.onended = () => {
                      if (this.demoAudioContext.currentTime >= nextPlaybackTime - 0.1) {
                         resetDemo();
                      }
                    };
                  }
                }
              }
              if (data.serverContent && data.serverContent.turnComplete) {
                ws.close();
                if (!hasReceivedAudio) resetDemo();
              }
            } catch (e) {
              console.error('Error parsing WS message', e);
            }
          };

          ws.onerror = (e) => {
            console.error('Demo WS error', e);
            alert('Ses üretilirken bağlantı hatası oluştu.');
            resetDemo();
          };

          ws.onclose = () => {
             if (this.demoSource === ws && !hasReceivedAudio) {
               resetDemo();
             }
          };

          const resetDemo = () => {
            this.isDemoPlaying = false;
            if (this.btnDemoVoice) this.btnDemoVoice.textContent = '▶️';
            this.demoSource = null;
          };

        } catch (err) {
          console.error(err);
          alert('Ses çalınırken hata: ' + err.message);
          this.isDemoPlaying = false;
          this.btnDemoVoice.textContent = '▶️';
        }
      });
    }
  }

  _loadCurrentSettings() {
    const settings = loadSettings();
    if (this.inputs.geminiKey) this.inputs.geminiKey.value = settings.geminiKey || '';
    
    let voice = settings.geminiVoice || 'Kore';
    if (voice === 'female' || voice === 'auto') voice = 'Kore';
    if (voice === 'male') voice = 'Puck';
    if (this.inputs.geminiVoice) this.inputs.geminiVoice.value = voice;
    
    if (this.inputs.geminiSpeed) this.inputs.geminiSpeed.value = settings.voiceSpeed || '1.0';
    if (this.inputs.autoDisconnect) this.inputs.autoDisconnect.value = settings.autoDisconnectTimeout || 60;
  }

  _save() {
    const settings = loadSettings();

    if (this.inputs.geminiKey) settings.geminiKey = this.inputs.geminiKey.value.trim();
    if (this.inputs.geminiVoice) settings.geminiVoice = this.inputs.geminiVoice.value;
    if (this.inputs.geminiSpeed) settings.voiceSpeed = parseFloat(this.inputs.geminiSpeed.value) || 1.0;
    if (this.inputs.autoDisconnect) settings.autoDisconnectTimeout = parseInt(this.inputs.autoDisconnect.value) || 60;

    saveSettings(settings);

    if (this._onSave) this._onSave(settings);
    this.close();
  }

  open() {
    this._loadCurrentSettings();
    this.overlay.classList.add('open');
  }

  close() {
    this.overlay.classList.remove('open');
  }
}

