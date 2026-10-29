// ============================================
// DeutschVoice Agent — Dictionary Popup
// ============================================

import { fetchWordDetails } from '../services/dictionary-service.js';
import { addNotGermanWord } from '../utils/language-heuristics.js';

let popupEl = null;
let miniPopupEl = null;

export function initDictionaryPopup() {
  if (popupEl) return;
  
  popupEl = document.createElement('div');
  popupEl.className = 'dict-popup';
  popupEl.style.display = 'none';
  document.body.appendChild(popupEl);

  miniPopupEl = document.createElement('div');
  miniPopupEl.className = 'mini-dict-popup dict-popup';
  miniPopupEl.style.display = 'none';
  document.body.appendChild(miniPopupEl);

  // Close popups when clicking outside
  document.addEventListener('click', (e) => {
    const isInsideMini = miniPopupEl.contains(e.target) || e.target.closest('.nested-dict-word');
    if (miniPopupEl.style.display !== 'none' && !isInsideMini) {
      miniPopupEl.style.display = 'none';
    }

    const isInsideMain = popupEl.contains(e.target) || e.target.closest('.dict-word');
    if (popupEl.style.display !== 'none' && !isInsideMain && !isInsideMini) {
      popupEl.style.display = 'none';
      miniPopupEl.style.display = 'none'; // cascade close
    }
  });
}

export async function showDictionaryPopup(word, targetEl, apiKey, forceUpdate = false) {
  if (!popupEl) initDictionaryPopup();

  // Sadece harf ve rakamları tut, tüm noktalama ve sembolleri kaldır
  const rawWord = word.trim().replace(/[^\p{L}\p{N}]/gu, '');
  if (rawWord.length < 2) return;

  popupEl.style.display = 'flex';
  popupEl.innerHTML = '<div class="dict-loading">Aranıyor...</div>';
  
  // Position popup near targetEl
  const rect = targetEl.getBoundingClientRect();
  
  let left = rect.left;
  let top = rect.bottom + 8;
  
  popupEl.style.left = left + 'px';
  popupEl.style.top = top + 'px';

  try {
    const res = await fetchWordDetails(rawWord, apiKey, forceUpdate);
    
    if (res.pos === 'NOT_GERMAN') {
      popupEl.style.display = 'none';
      addNotGermanWord(rawWord);
      
      // Belgedeki bu kelimeye sahip tüm dom efektlerini (span) temizle
      document.querySelectorAll(`.dict-word[data-word="${rawWord}"]`).forEach(el => {
        const textNode = document.createTextNode(el.textContent);
        el.parentNode.replaceChild(textNode, el);
      });
      return;
    }
    
    popupEl.innerHTML = formatDictionaryPopup(res, rawWord);
    
    // Adjust position if it flows out of the screen
    const dr = popupEl.getBoundingClientRect();
    if (left + dr.width > window.innerWidth) {
      popupEl.style.left = Math.max(10, window.innerWidth - dr.width - 10) + 'px';
    }
    if (top + dr.height > window.innerHeight) {
      popupEl.style.top = Math.max(10, rect.top - dr.height - 8) + 'px';
    }
    
    // Setup TTS button
    const playBtn = popupEl.querySelector('.dict-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        playTTS(playBtn.getAttribute('data-tts-word'));
      });
    }

    // Setup Refresh button
    const refreshBtn = popupEl.querySelector('.dict-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        showDictionaryPopup(word, targetEl, apiKey, true);
      });
    }

    // Setup Nested Words
    const nestedWords = popupEl.querySelectorAll('.nested-dict-word');
    nestedWords.forEach(nw => {
      nw.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const nWord = nw.getAttribute('data-word');
        
        miniPopupEl.style.display = 'flex';
        miniPopupEl.innerHTML = '<div class="dict-loading">Aranıyor...</div>';
        
        const nwRect = nw.getBoundingClientRect();
        miniPopupEl.style.left = nwRect.left + 'px';
        miniPopupEl.style.top = (nwRect.bottom + 8) + 'px';
        
        try {
          const renderMiniPopup = (res) => {
            const isNotGerman = res.pos === 'NOT_GERMAN';
            const anlam = isNotGerman ? 'Almanca değil' : (res.trTranslation || '-');
            const color = isNotGerman ? 'var(--text-secondary)' : 'inherit';
            
            miniPopupEl.innerHTML = `
              <div class="dict-popup-header">
                <div class="dict-row" style="margin: 0; color: ${color};">
                  <span class="dict-label" style="width: auto; margin-right: 8px;">Bedeutung (Tr)</span>
                  <span class="dict-colon">:</span>
                  <span class="dict-value" style="font-weight: 700;">${anlam}</span>
                </div>
                <button class="mini-refresh-btn" style="background:none; border:none; cursor:pointer; font-size:12px; margin-left: 8px;" title="Yenile (LLM)">🔄</button>
              </div>
            `;
            
            // Setup Mini Refresh button
            const miniRefreshBtn = miniPopupEl.querySelector('.mini-refresh-btn');
            miniRefreshBtn.addEventListener('click', async (e) => {
              e.stopPropagation();
              miniPopupEl.innerHTML = '<div class="dict-loading">Yenileniyor...</div>';
              try {
                const freshRes = await fetchWordDetails(nWord, apiKey, true);
                renderMiniPopup(freshRes);
              } catch (err) {
                 miniPopupEl.innerHTML = '<div class="dict-loading">Hata</div>';
              }
            });
          };

          const miniRes = await fetchWordDetails(nWord, apiKey);
          renderMiniPopup(miniRes);
          
          // Adjust position if out of bounds
          const mr = miniPopupEl.getBoundingClientRect();
          if (nwRect.left + mr.width > window.innerWidth) {
            miniPopupEl.style.left = Math.max(10, window.innerWidth - mr.width - 10) + 'px';
          }
          if (nwRect.bottom + 8 + mr.height > window.innerHeight) {
            miniPopupEl.style.top = Math.max(10, nwRect.top - mr.height - 8) + 'px';
          }
        } catch (err) {
          miniPopupEl.innerHTML = `<div class="dict-loading">Hata</div>`;
        }
      });
    });

  } catch (err) {
    console.error('Dictionary API Error:', err);
    popupEl.innerHTML = `<div class="dict-loading">Hata: ${err.message}</div>`;
  }
}

function formatDictionaryPopup(res, rawWord) {
  const posLower = (res.pos || '').toLowerCase();
  
  // Use regex word boundaries to prevent 'pronomen' matching 'nomen' and 'adverb' matching 'verb'
  const isNoun = /\b(nomen|substantiv|isim)\b/.test(posLower);
  const isVerb = /\b(verb|fiil)\b/.test(posLower);
  const isPronoun = posLower.includes('pronomen') || posLower.includes('zamir');
  const isAdverb = posLower.includes('adverb') || posLower.includes('zarf');
  
  const tür = res.pos || '-';
  const displayWord = rawWord;

  // Determine Color based on POS
  let wordColor = 'var(--text-primary)';
  if (isNoun) wordColor = '#3b82f6'; // Daha Koyu Mavi
  else if (isVerb) wordColor = '#f87171'; // Kırmızı
  else if (isAdverb) wordColor = '#a78bfa'; // Mor
  else if (isPronoun) wordColor = '#fb923c'; // Turuncu
  else if (posLower.includes('adjektiv') || posLower.includes('sıfat')) wordColor = '#34d399'; // Yeşil
  else if (posLower.includes('artikel')) wordColor = '#facc15'; // Sarı
  else if (posLower.includes('präposition') || posLower.includes('edat')) wordColor = '#f472b6'; // Pembe
  else if (posLower.includes('konjunktion') || posLower.includes('bağlaç')) wordColor = '#d97706'; // Kahverengi (Soft)
  else if (posLower.includes('numerale') || posLower.includes('sayı')) wordColor = '#9ca3af'; // Gri
  else if (posLower.includes('interjektion') || posLower.includes('ünlem')) wordColor = '#67e8f9'; // Çok Açık Mavi

  // Build rows conditionally
  let rowsHtml = '';

  // Part of speech
  rowsHtml += `<div class="dict-row">
    <span class="dict-label">Wortart (Tür)</span>
    <span class="dict-colon">:</span>
    <span class="dict-value">${tür}</span>
  </div>`;

  // Artikel row
  if (isNoun && res.article && res.article !== '' && res.article !== '-') {
    const singularWord = (res.singular && res.singular !== '-') ? res.singular : displayWord;
    const capitalizedWord = singularWord.charAt(0).toUpperCase() + singularWord.slice(1);
    
    let coloredArticle = res.article.replace(/\b(der|die|das)\b/gi, (match) => {
      return `<span class="art-${match.toLowerCase()}">${match}</span>`;
    });

    const artikelHtml = `${coloredArticle} ${capitalizedWord}`;
      
    rowsHtml += `<div class="dict-row">
      <span class="dict-label">Artikel</span>
      <span class="dict-colon">:</span>
      <span class="dict-value">${artikelHtml}</span>
    </div>`;
  }

  // Plural row
  if (isNoun && res.plural && res.plural !== '-') {
    rowsHtml += `<div class="dict-row">
      <span class="dict-label">Plural (Çoğul)</span>
      <span class="dict-colon">:</span>
      <span class="dict-value">${res.plural}</span>
    </div>`;
  }

  // Infinitive row
  if (isVerb && res.infinitive && res.infinitive !== '-') {
    rowsHtml += `<div class="dict-row">
      <span class="dict-label">Infinitiv (Mastar)</span>
      <span class="dict-colon">:</span>
      <span class="dict-value">${res.infinitive}</span>
    </div>`;
  }

  // Derivations (Array or Fallback)
  let derivationsToRender = [];
  if (Array.isArray(res.derivations)) {
    derivationsToRender = res.derivations;
  } else if (res.derivationLabel && res.derivationText && res.derivationLabel !== '-' && res.derivationText !== '-') {
    derivationsToRender.push({ label: res.derivationLabel, text: res.derivationText });
  }

  derivationsToRender.forEach(deriv => {
    if (deriv.label && deriv.text && deriv.text !== '-') {
      let derivationParts = deriv.text.split('/');
      let singularPart = derivationParts[0].trim();
      
      // Extract the core phrase by removing definite articles from the start
      let targetPhrase = singularPart.replace(/^(?:der-die-das|der|die|das)\s+/i, '').trim();
      
      if (targetPhrase) {
          // Wrap the exact target phrase
          let wrappedSingularPart = singularPart.replace(targetPhrase, `<span class="nested-dict-word" data-word="${targetPhrase}">$&</span>`);
          derivationParts[0] = wrappedSingularPart;
      }
      
      let newDerivationText = derivationParts.join('/');
      
      // Color articles
      let coloredDerivationText = newDerivationText.replace(/\b(der|die|das)\b/g, (match) => {
        return `<span class="art-${match}">${match}</span>`;
      });
      
      rowsHtml += `<div class="dict-row">
        <span class="dict-label">${deriv.label}</span>
        <span class="dict-colon">:</span>
        <span class="dict-value">${coloredDerivationText}</span>
      </div>`;
    }
  });

  // Meaning row
  const anlamı = res.trTranslation || '-';
  rowsHtml += `<div class="dict-row">
    <span class="dict-label">Bedeutung (Tr)</span>
    <span class="dict-colon">:</span>
    <span class="dict-value">${anlamı}</span>
  </div>`;

  return `
    <div class="dict-popup-header">
      <div class="dict-word" style="color: ${wordColor}; font-size: 1.1em;">${displayWord}</div>
      <div style="display: flex; gap: 4px;">
        <button class="dict-refresh-btn" title="Yenile (LLM)">
          🔄
        </button>
        <button class="dict-play-btn" data-tts-word="${displayWord}" title="Dinle">
          🔊
        </button>
      </div>
    </div>
    ${rowsHtml}
  `;
}

function playTTS(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // Stop any currently playing TTS
  
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  utterance.rate = 0.9;
  
  window.speechSynthesis.speak(utterance);
}
