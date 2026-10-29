// ============================================
// DeutschVoice Agent — Main Application Logic
// Orchestrates all services and components
// ============================================

import { GeminiLiveAPIClient } from './services/gemini-agent-service.js';
import {
  createUserBubble,
  createFeedbackBubble,
  createChatBubble,
  createSystemBubble,
  formatChatText
} from './components/chat-bubble.js';
import { WaveformVisualizer } from './components/waveform.js';
import { SettingsModal } from './components/settings-modal.js';
import { HistoryPanel } from './components/history-panel.js';
import { VocabularyModal } from './components/vocabulary-modal.js';
import { TOPIC_LABELS } from './utils/constants.js';
import {
  loadSettings,
  saveSettings,
  loadConversations,
  getActiveConversationId,
  setActiveConversationId,
  createConversation,
  addMessage,
  getConversationMessages,
  updateConversation,
  updateMessageTranslation,
  updateMessageAudio,
  deleteMessage,
  syncConversationsWithSupabase
} from './utils/storage.js';
import { saveAudio } from './utils/audioDB.js';
import { initDictionaryPopup, showDictionaryPopup } from './components/dictionary-popup.js';
import { syncWordBankWithSupabase } from './services/dictionary-service.js';
import { migrateLocalDataToSupabase } from './services/supabase-service.js';

export class App {
  constructor() {
    this.waveform = null;
    this.settings = loadSettings();
    this.geminiLiveClient = new GeminiLiveAPIClient();

    // State
    this.currentConversationId = null;
    this.isProcessing = false;
    this.chatHistory = []; // Messages for LLM context

    // DOM Elements
    this.chatMessages = document.getElementById('chat-messages');
    this.chatArea = document.getElementById('chat-area');
    this.welcomeScreen = document.getElementById('welcome-screen');
    this.micButton = document.getElementById('btn-mic');
    this.micStatus = document.getElementById('mic-status');
    this.waveformContainer = document.getElementById('waveform-container');
    this.waveformCanvas = document.getElementById('waveform-canvas');
    this.textInput = document.getElementById('text-input');
    

    // Audio Toggles (Live)
    this.btnLiveMic = document.getElementById('btn-live-mic');
    this.btnLiveAudio = document.getElementById('btn-live-audio');
    this.btnLiveFeedback = document.getElementById('btn-live-feedback');
    this.btnLiveFeedbackLang = document.getElementById('btn-live-feedback-lang');
    this.btnInteractionMode = document.getElementById('btn-interaction-mode');
    this.modeIcon = document.getElementById('mode-icon');
    this.btnDisconnect = document.getElementById('btn-disconnect');
    this.liveTogglesContainer = document.getElementById('live-toggles');
    
    // Speed Controls
    this.btnSpeedDown = document.getElementById('btn-speed-down');
    this.btnSpeedUp = document.getElementById('btn-speed-up');
    this.labelSpeedValue = document.getElementById('label-speed-value');

    // Controls
    this.btnSettings = document.getElementById('btn-settings');
    this.sendBtn = document.getElementById('btn-send');
    this.selectLevel = document.getElementById('select-level');
    this.selectTopic = document.getElementById('select-topic');
    this.badgeLevel = document.getElementById('badge-level');
    this.badgeTopic = document.getElementById('badge-topic');
    this.toastContainer = document.getElementById('toast-container');

    window.translateText = async (text) => {
      let apiKey = this.settings.geminiKey;
      if (!apiKey) throw new Error('API Anahtarı eksik. Ayarlardan kontrol edin.');
      apiKey = apiKey.trim();

      // Hardcode the fastest model with largest quota for translation
      const targetModel = 'gemini-3.1-flash-lite';

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
      const payload = {
        system_instruction: {
          parts: [{ text: "Sen bir çevirmen ve metin düzenleyicisin. Sana verilen metin Türkçe ve Almanca karışık olabilir.\n\nGÖREVİN:\n1. Metnin ORİJİNAL SATIR ATLAMALARINI (paragraf boşluklarını) KESİNLİKLE koruyacaksın. Asla satırları birleştirme.\n2. Metindeki TÜRKÇE kısımlara HİÇ DOKUNMA, birebir aynısını yaz.\n3. Çift tırnak (\"...\") içindeki ifadeleri KESİNLİKLE ÇEVİRME, orijinal haliyle bırak.\n4. Orijinal metinde olmayan yeni çift tırnak işaretleri ASLA EKLEME.\n5. Sadece çift tırnak dışındaki ALMANCA kısımları Türkçeye çevir.\n6. Sadece son metni ver." }]
        },
        contents: [{
          parts: [{ text }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      
      if (!response.ok) {
        console.error('Translation API Error:', data);
        throw new Error(data.error?.message || 'API Error');
      }
      
      if (data.candidates && data.candidates.length > 0) {
        const parts = data.candidates[0].content?.parts;
        if (parts && parts.length > 0) {
          return parts.map(p => p.text).join('');
        }
      }
      
      console.error('Translation blocked or empty response:', data);
      throw new Error('Çeviri yanıtı boş. (Güvenlik engeli veya beklenmeyen yanıt yapısı)');
    };

    // Listen for translations to save them
    this.chatMessages.addEventListener('translation-fetched', (e) => {
      const { originalText, translation } = e.detail;
      if (this.currentConversationId) {
        updateMessageTranslation(this.currentConversationId, originalText, translation);
      }
    });

    this.chatMessages.addEventListener('message-deleted', (e) => {
      const { textContent } = e.detail;
      if (this.currentConversationId) {
        deleteMessage(this.currentConversationId, textContent);
      }
      
      // Also remove it from the in-memory history
      this.chatHistory = this.chatHistory.filter(msg => msg.content !== textContent);
    });

    // History & Vocabulary Panel Controls
    this.settingsModal = new SettingsModal();
    this.historyPanel = new HistoryPanel();
    this.vocabularyModal = new VocabularyModal();

    this.btnVocabulary = document.getElementById('btn-vocabulary');
    if (this.btnVocabulary) {
      this.btnVocabulary.addEventListener('click', () => {
        this.vocabularyModal.show();
      });
    }

    this._init();
  }

  _init() {
    // Audio toggles
    this._initAudioToggles();
    this._initSpeedControl();

    // Initialize waveform
    this.waveform = new WaveformVisualizer(this.waveformCanvas);

    // Bind events
    this._bindMicButton();
    this._bindTextInput();
    this._bindQuickControls();
    this._bindHintChips();
    this._bindSettingsCallbacks();
    this._bindHistoryCallbacks();

    // Dictionary Feature (Supabase Entegreli)
    initDictionaryPopup();
    syncWordBankWithSupabase();

    this.chatMessages.addEventListener('click', (e) => {
      if (e.target.classList.contains('dict-word')) {
        const word = e.target.dataset.word;
        if (word) {
          showDictionaryPopup(word, e.target, this.settings.geminiKey);
        }
      }
    });

    // Load initial state
    this._loadSavedState();
    
    // Show initial state
    this._updateBadges();
  }

  // ================================
  // Event Binding
  // ================================

  _initSpeedControl() {
    if (!this.btnSpeedDown || !this.btnSpeedUp || !this.labelSpeedValue) return;
    
    const updateLabel = () => {
      this.labelSpeedValue.textContent = (this.settings.voiceSpeed || 1.0).toFixed(2) + 'x';
    };
    
    const changeSpeed = (delta) => {
      let current = this.settings.voiceSpeed || 1.0;
      current += delta;
      // Clamp between 0.5 and 2.0
      if (current < 0.5) current = 0.5;
      if (current > 2.0) current = 2.0;
      
      this.settings.voiceSpeed = current;
      updateLabel();
      saveSettings(this.settings);
      
      if (this.geminiLiveClient) {
        this.geminiLiveClient.setPlaybackRate(this.settings.voiceSpeed);
      }
    };

    this.btnSpeedDown.addEventListener('click', () => changeSpeed(-0.05));
    this.btnSpeedUp.addEventListener('click', () => changeSpeed(0.05));
    
    updateLabel();
  }

  _initAudioToggles() {
    if (this.liveTogglesContainer) {
      this.liveTogglesContainer.style.display = 'flex';
    }

    // Live Toggles
    this._updateToggleUI(this.btnLiveAudio, this.settings.liveAudioEnabled);
    this._updateToggleUI(this.btnLiveFeedback, this.settings.liveFeedbackEnabled);
    
    // Custom UI update for language toggle
    if (this.btnLiveFeedbackLang) {
      const flag = this.btnLiveFeedbackLang.querySelector('.flag');
      if (this.settings.liveFeedbackLang === 'DE') {
        if (flag) flag.textContent = '🇩🇪';
        this.btnLiveFeedbackLang.title = 'Geri Bildirim Dili: Almanca';
      } else {
        if (flag) flag.textContent = '🇹🇷';
        this.btnLiveFeedbackLang.title = 'Geri Bildirim Dili: Türkçe';
      }
    }

    if (this.btnLiveMic) {
      this._updateToggleUI(this.btnLiveMic, this.settings.liveMicEnabled);

      this.btnLiveMic.addEventListener('click', () => {
        this.settings.liveMicEnabled = !this.settings.liveMicEnabled;
        this._updateToggleUI(this.btnLiveMic, this.settings.liveMicEnabled);
        saveSettings(this.settings);
        
        // DYNAMIC UPDATE: Mic aç/kapat hemen etki etsin
        if (this.geminiLiveClient) {
          this.geminiLiveClient.setMicEnabled(this.settings.liveMicEnabled);
        }
      });
    }

    if (this.btnLiveAudio) {
      this.btnLiveAudio.addEventListener('click', () => {
        this.settings.liveAudioEnabled = !this.settings.liveAudioEnabled;
        this._updateToggleUI(this.btnLiveAudio, this.settings.liveAudioEnabled);
        saveSettings(this.settings);
        
        // DYNAMIC UPDATE: Ses aç/kapat hemen etki etsin
        if (this.geminiLiveClient) {
          this.geminiLiveClient.setAudioEnabled(this.settings.liveAudioEnabled);
        }
      });
    }

    if (this.btnLiveFeedback) {
      this.btnLiveFeedback.addEventListener('click', () => {
        this.settings.liveFeedbackEnabled = !this.settings.liveFeedbackEnabled;
        this._updateToggleUI(this.btnLiveFeedback, this.settings.liveFeedbackEnabled);
        saveSettings(this.settings);
        this._showToast('Değişiklik bir sonraki kayıtta geçerli olacak', 'info');
      });
    }

    if (this.btnLiveFeedbackLang) {
      this.btnLiveFeedbackLang.addEventListener('click', () => {
        this.settings.liveFeedbackLang = this.settings.liveFeedbackLang === 'TR' ? 'DE' : 'TR';
        
        const flag = this.btnLiveFeedbackLang.querySelector('.flag');
        if (this.settings.liveFeedbackLang === 'DE') {
          if (flag) flag.textContent = '🇩🇪';
          this.btnLiveFeedbackLang.title = 'Geri Bildirim Dili: Almanca';
        } else {
          if (flag) flag.textContent = '🇹🇷';
          this.btnLiveFeedbackLang.title = 'Geri Bildirim Dili: Türkçe';
        }
        
        saveSettings(this.settings);
        this._showToast('Dil değişikliği bir sonraki kayıtta geçerli olacak', 'info');
      });
    }

    if (this.btnInteractionMode) {
      if (!this.settings.interactionMode) this.settings.interactionMode = 'live';
      this._updateModeUI();
      if (this.geminiLiveClient) {
         this.geminiLiveClient.setInteractionMode(this.settings.interactionMode);
      }

      this.btnInteractionMode.addEventListener('click', () => {
        this.settings.interactionMode = this.settings.interactionMode === 'live' ? 'ptt' : 'live';
        this._updateModeUI();
        saveSettings(this.settings);
        this._showToast(this.settings.interactionMode === 'ptt' ? 'Telsiz (Bas-Konuş) Modu Aktif' : 'Akıcı Konuşma Modu Aktif', 'info');
        if (this.geminiLiveClient) {
           this.geminiLiveClient.setInteractionMode(this.settings.interactionMode);
        }
      });
    }
    
    if (this.btnDisconnect) {
       this.btnDisconnect.addEventListener('click', () => {
          if (this.geminiLiveClient) this.geminiLiveClient.disconnect();
       });
    }
  }

  _updateModeUI() {
    if (!this.btnInteractionMode || !this.modeIcon) return;
    if (this.settings.interactionMode === 'ptt') {
      this.modeIcon.textContent = '📻';
      this.btnInteractionMode.title = 'Mod: Telsiz (Başlat/Gönder)';
      if (this.geminiLiveClient && this.geminiLiveClient.isPttRecording) {
         this.micStatus.textContent = 'Sıra Sizde. Göndermek İçin Tıklayın.';
      } else {
         this.micStatus.textContent = 'Konuşmak İçin Tıklayın';
      }
    } else {
      this.modeIcon.textContent = '🗣️';
      this.btnInteractionMode.title = 'Mod: Akıcı Konuşma';
      this.micStatus.textContent = 'Canlı Görüşme (Konuşmak İçin Tıklayın)';
    }
  }

  _updateToggleUI(btn, isActive) {
    if (!btn) return;
    if (isActive) {
      btn.classList.add('active');
      if (btn.id === 'btn-live-mic') btn.title = 'Mikrofonu Kapat';
      else if (btn.id === 'btn-live-audio') btn.title = 'Sesi Kapat';
      else if (btn.id === 'btn-live-feedback') btn.title = 'Hata Düzeltme & Geri Bildirim (Açık)';
      else if (!btn.title.includes('(Açık)')) btn.title = btn.title.replace(' (Kapalı)', '').replace('(Kapalı)', '') + ' (Açık)';
    } else {
      btn.classList.remove('active');
      if (btn.id === 'btn-live-mic') btn.title = 'Mikrofonu Aç';
      else if (btn.id === 'btn-live-audio') btn.title = 'Sesi Aç';
      else if (btn.id === 'btn-live-feedback') btn.title = 'Hata Düzeltme & Geri Bildirim (Kapalı)';
      else if (!btn.title.includes('(Kapalı)')) btn.title = btn.title.replace(' (Açık)', '').replace('(Açık)', '') + ' (Kapalı)';
    }
  }

  _bindMicButton() {
    this.micButton.addEventListener('click', async (e) => {
      e.preventDefault();
      if (this.isProcessing) return;

      if (this.settings.interactionMode === 'ptt') {
        // Telsiz Modu (Toggle Mantığı)
        if (!this.geminiLiveClient.isConnected) {
           await this._toggleGeminiLiveCall();
           setTimeout(() => this.geminiLiveClient.startPttRecording(), 500);
        } else {
           if (this.geminiLiveClient.isPttRecording) {
             // Sıra asistana geçiyor, gönder
             this.geminiLiveClient.stopPttRecording();
           } else {
             // Sıra kullanıcıya geçiyor, kayda başla
             this.geminiLiveClient.startPttRecording();
           }
        }
      } else {
        // Akıcı Mod (Normal Aç/Kapat)
        this._toggleGeminiLiveCall();
      }
    });
  }

  _bindTextInput() {
    this.textInput.addEventListener('input', () => {
      this.sendBtn.disabled = this.textInput.value.trim().length === 0;
    });

    this.textInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this._sendTextMessage();
      }
    });

    this.sendBtn.addEventListener('click', () => {
      this._sendTextMessage();
    });
  }

  _bindQuickControls() {
    this.selectLevel.addEventListener('change', () => {
      this.settings.level = this.selectLevel.value;
      saveSettings(this.settings);
      this._updateBadges();
    });

    this.selectTopic.addEventListener('change', () => {
      this.settings.topic = this.selectTopic.value;
      saveSettings(this.settings);
      this._updateBadges();
    });
  }

  _bindHintChips() {
    document.querySelectorAll('.hint-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const hint = chip.dataset.hint;
        if (hint) {
          this.textInput.value = hint;
          this.sendBtn.disabled = false;
          this._sendTextMessage();
        }
      });
    });
  }

  _bindSettingsCallbacks() {
    this.settingsModal.onSave = (newSettings) => {
      this.settings = newSettings;
      
      // DYNAMIC UPDATE: Ses hızını anında uygula
      if (this.geminiLiveClient) {
        this.geminiLiveClient.setPlaybackRate(this.settings.voiceSpeed || 1.0);
      }
      
      this._showToast('Ayarlar kaydedildi', 'success');
    };

    this.settingsModal.onClearHistory = () => {
      this._startNewConversation();
      this.historyPanel.render(null);
      this._showToast('Tüm sohbet geçmişi silindi', 'success');
    };
  }

  _bindHistoryCallbacks() {
    this.historyPanel.onSelectConversation = (conv) => {
      this._loadConversation(conv.id);
    };

    this.historyPanel.onNewChat = (conv) => {
      this._startNewConversation(conv);
    };
  }

  // ================================
  // Gemini Agent Pipeline (Live API)
  // ================================

  // --- Gemini Agent Pipeline (Live API) ---
  async _toggleGeminiLiveCall() {
    if (this.geminiLiveClient.isConnected) {
      this.geminiLiveClient.disconnect();
      return;
    }

    if (!this.settings.geminiKey) {
      this._showToast('Lütfen ayarlardan Gemini API anahtarını girin.', 'error');
      return;
    }

    this._hideWelcomeScreen();
    this._ensureConversation();

    try {
      await this.geminiLiveClient.connect({
        geminiKey: this.settings.geminiKey,
        level: this.settings.level,
        topic: this.settings.topic,
        voicePreference: this.settings.geminiVoice,
        feedbackEnabled: this.settings.liveFeedbackEnabled,
        feedbackLang: this.settings.liveFeedbackLang,
        audioEnabled: this.settings.liveAudioEnabled,
        micEnabled: this.settings.liveMicEnabled,
        voiceSpeed: this.settings.voiceSpeed,
        onAgentAudioReady: async (audioId, float32Data) => {
          this.currentAudioId = audioId;
          try {
            await saveAudio(audioId, float32Data);
            // If the text bubble was already rendered, attach the audio
            const lastBubble = this.chatMessages.lastElementChild;
            if (lastBubble && lastBubble.classList.contains('assistant-message')) {
               lastBubble.dataset.audioId = audioId;
               lastBubble.dispatchEvent(new CustomEvent('audio-ready', { bubbles: true }));
            }
          } catch (err) {
            console.error('Audio DB save error:', err);
          }
        },
        onText: (text) => {
          // Accumulate agent text for history saving
          this.currentLiveAgentText = (this.currentLiveAgentText || '') + text;

          // Check if the last bubble was an assistant bubble
          const lastBubble = this.chatMessages.lastElementChild;
          if (lastBubble && lastBubble.classList.contains('chat-bubble') && !lastBubble.classList.contains('chat-bubble--feedback') && lastBubble.classList.contains('assistant-message')) {
            // Re-render the full text content to preserve paragraphs and bolding
            const contentDiv = lastBubble.querySelector('.bubble-content');
            if (contentDiv) {
              contentDiv.innerHTML = formatChatText(this.currentLiveAgentText);
            }
          } else {
            // Create new assistant bubble
            const bubble = createChatBubble(text, null, this.currentAudioId);
            bubble.classList.add('assistant-message');
            this.chatMessages.appendChild(bubble);
          }
          this._scrollToBottom();
        },
        onStateChange: (state, error) => {
          if (state === 'connecting') {
            this.micStatus.textContent = 'Bağlanıyor...';
            this.micStatus.className = 'mic-status recording';
            this.micButton.classList.add('recording');
          } else if (state === 'connected') {
            this.btnDisconnect.style.display = 'inline-block';
            if (error === 'İlk veri alındı') {
              this._showToast('İlk ses/veri paketi ulaştı!', 'success');
            } else {
              this.micStatus.textContent = this.settings.interactionMode === 'ptt' ? 'Konuşmak İçin Tıklayın' : 'Canlı Görüşme Aktif (Konuşun)';
              this.micStatus.className = 'mic-status recording';
              this.micButton.classList.add('recording');
              this._showToast('Bağlantı kuruldu.', 'success');
            }
          } else if (state === 'disconnected') {
            this.btnDisconnect.style.display = 'none';
            // Save the last agent message if exists before disconnecting
            if (this.currentLiveAgentText && this.currentLiveAgentText.trim().length > 0) {
              if (this.currentConversationId) {
                addMessage(this.currentConversationId, 'assistant', this.currentLiveAgentText);
              }
              this.chatHistory.push({ role: 'assistant', content: this.currentLiveAgentText });
              this.currentLiveAgentText = '';
            }

            this.micStatus.textContent = 'Mikrofona tıklayın ve konuşun';
            this.micStatus.className = 'mic-status idle';
            this.micButton.classList.remove('recording');
          } else if (state === 'agent_turn_complete') {
            // Sadece agent cümlesi bittiyse ve yazılacak metin varsa veritabanına kaydet.
            if (this.currentLiveAgentText && this.currentLiveAgentText.trim().length > 0) {
              if (this.currentConversationId) {
                addMessage(this.currentConversationId, 'assistant', this.currentLiveAgentText, this.currentAudioId);
              }
              this.chatHistory.push({ role: 'assistant', content: this.currentLiveAgentText, audioId: this.currentAudioId });
              
              const lastBubble = this.chatMessages.lastElementChild;
              if (lastBubble && lastBubble.classList.contains('assistant-message') && this.currentAudioId) {
                 lastBubble.dataset.audioId = this.currentAudioId;
                 lastBubble.dispatchEvent(new CustomEvent('audio-ready', { bubbles: true }));
              }
              
              this.currentLiveAgentText = '';
              this.currentAudioId = null;
            }
          } else if (state === 'user_text_interim') {
            this.textInput.value = error; // Show interim text in the input box
          } else if (state === 'ptt_start') {
            this.micStatus.textContent = 'Sıra Sizde. Göndermek İçin Tıklayın.';
            this.micButton.classList.add('active');
          } else if (state === 'ptt_stop') {
            this.micStatus.textContent = 'Sıra Asistanda, Cevap Bekleniyor...';
            this.micButton.classList.remove('active');
            setTimeout(() => {
                if (this.geminiLiveClient && this.geminiLiveClient.isConnected && this.settings.interactionMode === 'ptt') {
                   this.micStatus.textContent = 'Konuşmak İçin Tıklayın';
                }
            }, 1500);
          } else if (state === 'user_text') {
            this.textInput.value = ''; // Clear interim text
            
            // Eğer "turnComplete" gelmediyse ama kullanıcı konuşmaya başladıysa, kalan agent metnini zorla kaydet
            if (this.currentLiveAgentText && this.currentLiveAgentText.trim().length > 0) {
              if (this.currentConversationId) {
                addMessage(this.currentConversationId, 'assistant', this.currentLiveAgentText);
              }
              this.chatHistory.push({ role: 'assistant', content: this.currentLiveAgentText });
              this.currentLiveAgentText = '';
            }

            // "error" variable holds the text for this special state
            const text = error;
            const userBubble = createUserBubble(text);
            this.chatMessages.appendChild(userBubble);
            this._scrollToBottom();
            
            // Save user message to history
            if (this.currentConversationId) {
              addMessage(this.currentConversationId, 'user', text);
            }
            this.chatHistory.push({ role: 'user', content: text });
          } else if (state === 'debug') {
            this._showToast(error, 'info'); // Using toast for UI-based debug logs
          } else if (state === 'timeout_disconnect') {
            this._showToast(error || 'Sessizlik nedeniyle bağlantı kesildi', 'error');
          } else if (state === 'error') {
            this._showToast(error, 'error');
            this.micStatus.textContent = 'Bağlantı Hatası';
            this.micStatus.className = 'mic-status error';
            this.micButton.classList.remove('recording');
            setTimeout(() => {
              if (!this.geminiLiveClient.isConnected) {
                this.micStatus.textContent = 'Mikrofona tıklayın ve konuşun';
                this.micStatus.className = 'mic-status idle';
              }
            }, 3000);
          }
        }
      });
    } catch (err) {
      this._showToast('Bağlantı kurulamadı: ' + err.message, 'error');
    }
  }

  // ================================
  // Text Input Flow
  // ================================

  async _sendTextMessage() {
    const text = this.textInput.value.trim();
    if (!text) return;

    this.textInput.value = '';
    this.sendBtn.disabled = true;

    this._hideWelcomeScreen();
    this._ensureConversation();

    // If there is an accumulated agent text in Live Mode, save it before adding the user's new message
    if (this.currentLiveAgentText && this.currentLiveAgentText.trim().length > 0) {
      if (this.currentConversationId) {
        addMessage(this.currentConversationId, 'assistant', this.currentLiveAgentText);
      }
      this.chatHistory.push({ role: 'assistant', content: this.currentLiveAgentText });
      this.currentLiveAgentText = '';
    }

    const userBubble = createUserBubble(text);
    this.chatMessages.appendChild(userBubble);
    this._scrollToBottom();

    addMessage(this.currentConversationId, 'user', text);
    this.chatHistory.push({ role: 'user', content: text });

    if (this.geminiLiveClient.isConnected) {
      this.geminiLiveClient.sendText(text);
    } else {
      this._showToast('Lütfen önce canlı görüşmeyi başlatın (Mikrofon)', 'error');
    }
  }



  // ================================
  // Conversation Management
  // ================================

  _ensureConversation() {
    if (!this.currentConversationId) {
      const conv = createConversation();
      this.currentConversationId = conv.id;
      this.historyPanel.render(conv.id);
    }
  }

  _startNewConversation(conv) {
    this.chatHistory = [];
    this.isProcessing = false;

    // Clear chat area
    this.chatMessages.innerHTML = '';
    this._showWelcomeScreen();

    if (conv) {
      this.currentConversationId = conv.id;
    } else {
      this.currentConversationId = null;
    }

    this.historyPanel.render(this.currentConversationId);
  }

  _loadConversation(conversationId) {
    this.currentConversationId = conversationId;
    setActiveConversationId(conversationId);

    const messages = getConversationMessages(conversationId);
    this.chatHistory = messages.map(m => ({ role: m.role, content: m.content }));

    // Render messages
    this.chatMessages.innerHTML = '';

    if (messages.length === 0) {
      this._showWelcomeScreen();
    } else {
      this._hideWelcomeScreen();

      messages.forEach(msg => {
        let bubble = null;
        if (msg.role === 'user') {
          // Skip system pronunciation context messages
          if (msg.content.startsWith('[SYSTEM:')) return;
          bubble = createUserBubble(msg.content);
          this.chatMessages.appendChild(bubble);
        } else if (msg.role === 'assistant') {
          // Attempt simple parse to separate feedback and chat if they exist in the saved string
          const content = msg.content;
          let feedback = '';
          let chat = content;

          if (content.includes('[FEEDBACK]') && content.includes('[CHAT]')) {
            const parts = content.split('[CHAT]');
            feedback = parts[0].replace('[FEEDBACK]', '').trim();
            chat = parts[1].trim();
          } else if (content.includes('[FEEDBACK]')) {
            feedback = content.replace('[FEEDBACK]', '').trim();
            chat = '';
          }

          if (feedback) {
            this.chatMessages.appendChild(createFeedbackBubble(feedback));
          }
          if (chat) {
            this.chatMessages.appendChild(createChatBubble(chat, msg.translation, msg.audioId));
          }
        }
      });

      this._scrollToBottom();
    }

    this.historyPanel.render(conversationId);
  }

  _loadSavedState() {
    // Load settings into controls
    this.selectLevel.value = this.settings.level || 'B1';
    this.selectTopic.value = this.settings.topic || 'free';

    // Load active conversation
    const activeId = getActiveConversationId();
    if (activeId) {
      const conversations = loadConversations();
      if (conversations.find(c => c.id === activeId)) {
        this._loadConversation(activeId);
      } else {
        this.historyPanel.render(null);
      }
    } else {
      this.historyPanel.render(null);
    }

    // Tarayıcıdaki mevcut yerel verileri (konuşmalar, sesler, sözlük) Supabase'e aktar
    if (!localStorage.getItem('dv_migrated_to_supabase_v2')) {
      migrateLocalDataToSupabase().then(stats => {
        if (stats.conversations > 0 || stats.audio > 0 || stats.words > 0) {
          this._showToast(`Tarayıcıdaki veriler (${stats.conversations} sohbet, ${stats.audio} ses, ${stats.words} kelime) Supabase'e aktarıldı!`, 'success');
        }
        localStorage.setItem('dv_migrated_to_supabase_v2', 'true');
        return syncConversationsWithSupabase();
      }).then(() => {
        this.historyPanel.render(this.currentConversationId);
      }).catch(err => {
        console.warn('[App] Supabase migration error:', err);
      });
    } else {
      // Supabase'deki sohbet geçmişini asenkron olarak yerel ile senkronize et
      syncConversationsWithSupabase().then(() => {
        this.historyPanel.render(this.currentConversationId);
      }).catch(err => {
        console.warn('[App] Supabase ilk senkronizasyon:', err);
      });
    }
  }

  // ================================
  // UI Helpers
  // ================================

  _hideWelcomeScreen() {
    if (this.welcomeScreen) {
      this.welcomeScreen.style.display = 'none';
    }
  }

  _showWelcomeScreen() {
    if (!this.welcomeScreen) {
      // Recreate welcome screen
      const ws = document.createElement('div');
      ws.className = 'welcome-screen';
      ws.id = 'welcome-screen';
      ws.innerHTML = `
        <div class="welcome-icon">🇩🇪</div>
        <h1 class="welcome-title">Hallo! Almanca Pratiğe Başla</h1>
        <p class="welcome-subtitle">
          Mikrofona bas ve Almanca konuşmaya başla. Hatalarını düzeltip sana Türkçe geri bildirim vereceğim, sonra sohbetimize Almanca devam edeceğiz.
        </p>
        <div class="welcome-hints">
          <button class="hint-chip" data-hint="Hallo, ich heiße... Wie heißt du?">👋 Kendini tanıt</button>
          <button class="hint-chip" data-hint="Was kann ich hier in der Stadt machen?">🏙️ Şehir gezisi</button>
          <button class="hint-chip" data-hint="Ich möchte etwas bestellen, bitte.">🍽️ Restoran</button>
          <button class="hint-chip" data-hint="Können Sie mir den Weg erklären?">🗺️ Yol tarifi</button>
          <button class="hint-chip" data-hint="Ich habe ein Vorstellungsgespräch.">💼 İş görüşmesi</button>
        </div>
      `;
      this.chatMessages.appendChild(ws);
      this.welcomeScreen = ws;
      this._bindHintChips();
    }
    this.welcomeScreen.style.display = '';
  }

  _scrollToBottom() {
    requestAnimationFrame(() => {
      this.chatArea.scrollTop = this.chatArea.scrollHeight;
    });
  }

  _updateBadges() {
    this.badgeLevel.textContent = this.settings.level || 'B1';
    this.badgeTopic.textContent = TOPIC_LABELS[this.settings.topic] || 'Serbest';
  }

  _showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;

    const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
    toast.textContent = `${icon} ${message}`;

    this.toastContainer.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease-out forwards';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ================================
  // Cleanup
  // ================================

  destroy() {
    if (this.waveform) this.waveform.destroy();
  }
}
