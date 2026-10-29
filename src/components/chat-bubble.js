// ============================================
// DeutschVoice Agent — Chat Bubble Component
// ============================================

import { getAudio } from '../utils/audioDB.js';
import { isGermanWord, trStopWords } from '../utils/language-heuristics.js';

/**
 * Create a user message bubble
 * @param {string} text - Message text
 * @param {Object} [pronunciationResult] - Optional pronunciation assessment
 * @returns {HTMLElement}
 */
export function createUserBubble(text, pronunciationResult = null) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-bubble--user';

  const label = document.createElement('div');
  label.className = 'bubble-label bubble-label--user';
  label.textContent = '👤 Sen';

  const content = document.createElement('div');
  content.className = 'bubble-content';
  content.innerHTML = wrapWordsInHtml(escapeHtml(text));

  const header = document.createElement('div');
  header.className = 'bubble-header';
  header.appendChild(label);
  header.appendChild(createHeaderRightControls(bubble, text));

  bubble.appendChild(header);
  bubble.appendChild(content);

  // Add pronunciation badge if available
  if (pronunciationResult) {
    bubble.appendChild(createPronunciationBadge(pronunciationResult));
    if (pronunciationResult.words && pronunciationResult.words.length > 0) {
      bubble.appendChild(createPronunciationDetail(pronunciationResult));
    }
  }

  bubble.appendChild(createBubbleActions(bubble, text, false));

  return bubble;
}

/**
 * Create a feedback (Turkish) bubble
 * @param {string} text - Feedback text
 * @returns {HTMLElement}
 */
export function createFeedbackBubble(text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-bubble--assistant chat-bubble--feedback';

  const label = document.createElement('div');
  label.className = 'bubble-label bubble-label--tr';
  label.textContent = '🇹🇷 Geri Bildirim';

  const content = document.createElement('div');
  content.className = 'bubble-content';
  content.innerHTML = formatFeedbackText(text);

  const header = document.createElement('div');
  header.className = 'bubble-header';
  header.appendChild(label);
  header.appendChild(createHeaderRightControls(bubble, text));

  bubble.appendChild(header);
  bubble.appendChild(content);

  bubble.appendChild(createBubbleActions(bubble, text, false));

  return bubble;
}

/**
 * Create a chat (German) bubble
 * @param {string} text - German chat text
 * @param {string} [existingTranslation] - Optional existing translation
 * @param {string} [audioId] - Optional audio ID in IndexedDB
 * @returns {HTMLElement}
 */
export function createChatBubble(text, existingTranslation = null, audioId = null) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-bubble--assistant chat-bubble--chat';
  if (audioId) bubble.dataset.audioId = audioId;

  const label = document.createElement('div');
  label.className = 'bubble-label bubble-label--de';
  label.textContent = '🇩🇪 Almanca';

  const content = document.createElement('div');
  content.className = 'bubble-content';
  content.innerHTML = formatChatText(text, true);

  const header = document.createElement('div');
  header.className = 'bubble-header';
  header.appendChild(label);
  header.appendChild(createHeaderRightControls(bubble, text));

  bubble.appendChild(header);
  bubble.appendChild(content);

  const actions = createBubbleActions(bubble, text, true, existingTranslation, audioId);
  bubble.appendChild(actions);
  
  // Eger audio sonradan gelirse (streaming tamamlaninca) UI'i guncellemek icin
  bubble.addEventListener('audio-ready', () => {
     if (bubble.dataset.audioId && !actions.querySelector('.audio-controls')) {
       const audioControls = createAudioControls(bubble.dataset.audioId);
       const leftContainer = actions.querySelector('.audio-controls-container');
       if (leftContainer) {
         leftContainer.appendChild(audioControls);
       } else {
         actions.insertBefore(audioControls, actions.firstChild);
       }
     }
  });

  return bubble;
}

/**
 * Create a system message bubble
 * @param {string} text
 * @returns {HTMLElement}
 */
export function createSystemBubble(text) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble chat-bubble--system';
  bubble.textContent = text;
  return bubble;
}

// --- Helpers ---

function createHeaderRightControls(bubbleElement, textContent) {
  const container = document.createElement('div');
  container.style.display = 'flex';
  container.style.alignItems = 'center';
  container.style.gap = '8px';

  const timeEl = document.createElement('div');
  timeEl.className = 'bubble-time';
  const now = new Date();
  timeEl.textContent = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'bubble-action-btn delete-btn';
  deleteBtn.innerHTML = '🗑️';
  deleteBtn.title = 'Mesajı Sil';
  deleteBtn.style.width = '24px';
  deleteBtn.style.height = '24px';
  deleteBtn.style.fontSize = '0.75rem';
  deleteBtn.style.padding = '0';
  deleteBtn.style.background = 'transparent';
  deleteBtn.style.border = 'none';

  deleteBtn.addEventListener('click', () => {
    if (confirm('Bu mesajı silmek istediğinize emin misiniz?')) {
      bubbleElement.dispatchEvent(new CustomEvent('message-deleted', {
        detail: { textContent },
        bubbles: true
      }));
      bubbleElement.remove();
    }
  });

  container.appendChild(timeEl);
  container.appendChild(deleteBtn);

  return container;
}

function createBubbleActions(bubbleElement, textContent, isAssistant, existingTranslation = null, audioId = null) {
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'bubble-actions';
  actionsContainer.style.display = 'flex';
  actionsContainer.style.justifyContent = 'space-between';
  actionsContainer.style.width = '100%';

  const leftControls = document.createElement('div');
  leftControls.className = 'audio-controls-container';
  leftControls.style.display = 'flex';
  
  const rightControls = document.createElement('div');
  rightControls.style.display = 'flex';
  rightControls.style.gap = '8px';
  rightControls.style.marginLeft = 'auto'; // Push to the right

  // Play Audio Button
  if (isAssistant && audioId) {
    const audioControls = createAudioControls(audioId);
    leftControls.appendChild(audioControls);
  }

  actionsContainer.appendChild(leftControls);
  actionsContainer.appendChild(rightControls);

  // Translate Button (Only for German assistant chat)
  if (isAssistant) {
    const btnTranslate = document.createElement('button');
    btnTranslate.className = 'bubble-action-btn btn-translate';
    btnTranslate.title = 'Çevir';
    btnTranslate.innerHTML = '🌐';
    
    // Create translation box
    const translationBox = document.createElement('div');
    translationBox.className = 'translation-box';
    translationBox.style.display = 'none';
    
    const renderTranslationBox = (translationText) => {
      translationBox.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
          <strong>🇹🇷 Çeviri:</strong>
          <button class="bubble-action-btn btn-refresh-translation" title="Yeniden Çevir" style="width: 24px; height: 24px; font-size: 0.85rem; padding: 0; margin-left: auto;">🔄</button>
        </div>
        <div style="padding-left: 4px; border-left: 2px solid rgba(255,255,255,0.2);">${formatChatText(translationText)}</div>
      `;
      
      const refreshBtn = translationBox.querySelector('.btn-refresh-translation');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await fetchTranslation();
        });
      }
    };

    const fetchTranslation = async () => {
      translationBox.innerHTML = '<span class="loading-dots">Çevriliyor...</span>';
      translationBox.style.display = 'block';
      
      try {
        const translation = await window.translateText(textContent);
        if (translation) {
          renderTranslationBox(translation);
          bubbleElement.dispatchEvent(new CustomEvent('translation-fetched', {
            detail: { originalText: textContent, translation: translation },
            bubbles: true
          }));
        } else {
          translationBox.innerHTML = '<em>Çeviri başarısız oldu. API anahtarınızı kontrol edin.</em>';
        }
      } catch (err) {
        console.error(err);
        translationBox.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
            <em>Çeviri başarısız oldu: ${err.message || 'Bilinmeyen hata'}</em>
            <button class="bubble-action-btn btn-refresh-translation" title="Yeniden Dene" style="width: 24px; height: 24px; font-size: 0.85rem; padding: 0; margin-left: auto;">🔄</button>
          </div>
        `;
        const refreshBtn = translationBox.querySelector('.btn-refresh-translation');
        if (refreshBtn) {
           refreshBtn.addEventListener('click', async (e) => {
             e.stopPropagation();
             await fetchTranslation();
           });
        }
      }
    };

    if (existingTranslation) {
      renderTranslationBox(existingTranslation);
    }
    
    // We append the box to the bubble later when clicked
    bubbleElement.appendChild(translationBox);

    btnTranslate.addEventListener('click', async () => {
      if (translationBox.style.display === 'block') {
        translationBox.style.display = 'none';
        return;
      }
      
      // If we already have translation rendered
      if (translationBox.innerHTML && !translationBox.innerHTML.includes('loading-dots')) {
        translationBox.style.display = 'block';
        return;
      }

      await fetchTranslation();
    });
    rightControls.appendChild(btnTranslate);
  }

  // Copy Button
  const btnCopy = document.createElement('button');
  btnCopy.className = 'bubble-action-btn';
  btnCopy.title = 'Kopyala';
  btnCopy.innerHTML = '⧉';
  btnCopy.addEventListener('click', () => {
    const textToCopy = textContent;
    
    navigator.clipboard.writeText(textToCopy).then(() => {
      const originalHtml = btnCopy.innerHTML;
      btnCopy.innerHTML = '✅';
      btnCopy.style.color = '#2ecc71';
      setTimeout(() => {
        btnCopy.innerHTML = originalHtml;
        btnCopy.style.color = '';
      }, 2000);
    });
  });
  rightControls.appendChild(btnCopy);

  return actionsContainer;
}

function createPronunciationBadge(result) {
  const badge = document.createElement('div');
  badge.className = `pronunciation-badge pronunciation-badge--${result.rating}`;

  const icons = {
    excellent: '🌟',
    good: '👍',
    fair: '📝',
    poor: '🔄'
  };

  const labels = {
    excellent: 'Mükemmel',
    good: 'İyi',
    fair: 'Geliştirilmeli',
    poor: 'Pratik Gerekli'
  };

  badge.textContent = `${icons[result.rating]} Telaffuz: ${Math.round(result.pronScore)}/100 — ${labels[result.rating]}`;
  return badge;
}

function createPronunciationDetail(result) {
  const detail = document.createElement('div');
  detail.className = 'pronunciation-detail';

  result.words.forEach(w => {
    const span = document.createElement('span');
    const isCorrect = w.errorType === 'None';
    span.className = `pronunciation-word pronunciation-word--${isCorrect ? 'correct' : 'mispronounced'}`;
    span.textContent = w.word;
    if (!isCorrect) {
      span.title = `Hata: ${w.errorType} | Puan: ${w.accuracyScore}`;
    }
    detail.appendChild(span);
    detail.appendChild(document.createTextNode(' '));
  });

  return detail;
}

function createAudioControls(audioId) {
  const container = document.createElement('div');
  container.className = 'audio-controls';
  container.style.display = 'flex';
  container.style.gap = '4px';

  const btnPlayPause = document.createElement('button');
  btnPlayPause.className = 'bubble-action-btn btn-play-audio';
  btnPlayPause.title = 'Başlat / Beklet';
  btnPlayPause.innerHTML = '▶️';

  const btnStop = document.createElement('button');
  btnStop.className = 'bubble-action-btn btn-stop-audio';
  btnStop.title = 'Sonlandır';
  btnStop.innerHTML = '⏹️';

  let currentSource = null;
  let audioBuffer = null;
  let isPaused = false;
  let pauseTime = 0;
  let startedAt = 0;

  const stopAudio = () => {
    if (currentSource) {
      try { currentSource.stop(); } catch(e) {}
      currentSource.disconnect();
      currentSource = null;
    }
    isPaused = false;
    pauseTime = 0;
    btnPlayPause.innerHTML = '▶️';
  };

  // We register the stop function globally so that playing another audio stops this one
  const registerGlobalStop = () => {
    if (window.currentAudioPlayer && window.currentAudioPlayer !== stopAudio) {
      window.currentAudioPlayer();
    }
    window.currentAudioPlayer = stopAudio;
    // Reset all UI buttons
    document.querySelectorAll('.btn-play-audio').forEach(b => {
       if (b !== btnPlayPause) b.innerHTML = '▶️';
    });
  };

  btnStop.addEventListener('click', () => {
    if (window.currentAudioPlayer === stopAudio) {
      stopAudio();
      window.currentAudioPlayer = null;
    }
  });

  btnPlayPause.addEventListener('click', async () => {
    // If playing, pause it
    if (currentSource && !isPaused) {
      pauseTime += window.replayAudioContext.currentTime - startedAt;
      try { currentSource.stop(); } catch(e) {}
      currentSource.disconnect();
      currentSource = null;
      isPaused = true;
      btnPlayPause.innerHTML = '▶️';
      return;
    }

    registerGlobalStop();

    if (!window.replayAudioContext) {
      window.replayAudioContext = new AudioContext();
    }
    if (window.replayAudioContext.state === 'suspended') {
      await window.replayAudioContext.resume();
    }

    if (!audioBuffer) {
      const float32Data = await getAudio(audioId);
      if (!float32Data) {
        btnPlayPause.innerHTML = '⚠️';
        btnPlayPause.title = 'Ses bulunamadı';
        return;
      }
      audioBuffer = window.replayAudioContext.createBuffer(1, float32Data.length, 24000);
      audioBuffer.getChannelData(0).set(float32Data);
    }

    currentSource = window.replayAudioContext.createBufferSource();
    currentSource.buffer = audioBuffer;
    currentSource.connect(window.replayAudioContext.destination);

    currentSource.onended = () => {
      // Native onended fires even when stopped manually, so check if we truly ended
      if (!isPaused) {
        btnPlayPause.innerHTML = '▶️';
        pauseTime = 0;
        currentSource = null;
        if (window.currentAudioPlayer === stopAudio) window.currentAudioPlayer = null;
      }
    };

    btnPlayPause.innerHTML = '⏸️';
    isPaused = false;
    startedAt = window.replayAudioContext.currentTime;
    currentSource.start(0, pauseTime);
  });

  container.appendChild(btnPlayPause);
  container.appendChild(btnStop);
  
  return container;
}

/**
 * Format Turkish feedback text with basic styling
 */
function formatFeedbackText(text) {
  return text
    // Bold text between * *
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    // Italic text between _ _
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    // Grammar terms in single quotes
    .replace(/'([A-ZÄÖÜa-zäöüß]+(?:\s[A-ZÄÖÜa-zäöüß]+)*)'/g, '<span class="grammar-term">$1</span>')
    // Correct version marked with →
    .replace(/→\s*(.+?)(?=\n|$)/g, '→ <span class="correction-right">$1</span>')
    // Wrong version marked with ✗ or ✘
    .replace(/[✗✘]\s*(.+?)(?=\n|→|$)/g, '<span class="correction-wrong">$1</span> ')
    // Line breaks
    .replace(/\n/g, '<br>');
}

/**
 * Format German chat text
 */
export function formatChatText(text, wrapWords = false) {
  // First handle double asterisks (bold) and single asterisks/underscores
  let html = text
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<strong>$1</strong>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  if (wrapWords) {
    html = wrapWordsInHtml(html);
  }
  return html;
}

// Helper to escape HTML tags
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Helper to wrap words in text nodes
function wrapWordsInHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  
  function wrapTextNodes(node) {
    if (node.nodeType === 3) { // Text node
      const text = node.nodeValue;
      if (text.trim().length === 0) return;
      
      // Use Unicode property escapes to match any full word correctly.
      // This prevents fragmenting words with Turkish characters (e.g. "çalışıyor" -> "ç", "al", "ış", "yor").
      const regex = /([\p{L}]+)/gu;
      
      if (regex.test(text)) {
        const span = document.createElement('span');
        regex.lastIndex = 0;
        
        span.innerHTML = text.replace(regex, (match, m) => {
          if (isGermanWord(m) && !trStopWords.has(m.toLowerCase()) && m.length > 1) {
            return `<span class="dict-word" data-word="${m}">${m}</span>`;
          }
          return m;
        });
        
        node.parentNode.replaceChild(span, node);
      }
    } else if (node.nodeType === 1) { // Element node
      if (node.classList && node.classList.contains('dict-word')) return;
      // Copy childNodes to array since we'll modify the DOM structure
      Array.from(node.childNodes).forEach(wrapTextNodes);
    }
  }
  
  wrapTextNodes(div);
  
  // Eger ilk dugum span ise ve sadece 1 span varsa div sarmalina gerek yok,
  // ama innerHTML dondurecegimiz icin fark etmez.
  return div.innerHTML;
}
