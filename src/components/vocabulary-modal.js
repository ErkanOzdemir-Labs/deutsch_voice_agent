// ============================================
// DeutschVoice Agent - Vocabulary Modal Component
// ============================================


import { fetchWordsFromSupabase, toggleWordLearnedStatus } from '../services/supabase-service.js';

export class VocabularyModal {
  constructor() {
    this.modal = null;
    this.words = [];
    this.filteredWords = [];
    this.currentLevel = 'Tümü';
    this.searchQuery = '';
    this.isLoading = false;
    this.renderLimit = 60; // Sonsuz kaydırma ile performans optimizasyonu

    this._createModal();
  }

  _createModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'vocabulary-modal';

    overlay.innerHTML = `
      <div class="modal vocab-modal" style="max-width: 760px; max-height: 85vh; display: flex; flex-direction: column;">
        <div class="modal-header" style="flex-shrink: 0;">
          <h2 class="modal-title">📚 Almanca Kelime Listesi & Sözlük (A1–B2)</h2>
          <button class="modal-close" id="btn-close-vocab" aria-label="Kapat">✕</button>
        </div>

        <div class="vocab-controls" style="padding: 12px 20px; display: flex; gap: 10px; flex-wrap: wrap; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;">
          <input
            type="text"
            id="vocab-search"
            class="settings-input"
            placeholder="Kelime veya anlam ara..."
            style="flex: 1; min-width: 180px; margin: 0; padding: 8px 12px;"
          >
          <div class="vocab-level-chips" style="display: flex; gap: 6px; align-items: center;">
            <button class="hint-chip active" data-level="Tümü">Tümü</button>
            <button class="hint-chip" data-level="A1">A1</button>
            <button class="hint-chip" data-level="A2">A2</button>
            <button class="hint-chip" data-level="B1">B1</button>
            <button class="hint-chip" data-level="B2">B2</button>
          </div>
        </div>

        <div class="vocab-stats-bar" id="vocab-stats-bar" style="padding: 8px 20px; font-size: 0.8rem; color: rgba(255,255,255,0.6); display: flex; justify-content: space-between; border-bottom: 1px solid rgba(255,255,255,0.05); flex-shrink: 0;">
          <span id="vocab-count-label">Yükleniyor...</span>
          <span id="vocab-learned-label">⭐ Öğrenilen: 0</span>
        </div>

        <div class="vocab-list" id="vocab-list-container" style="flex: 1; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 10px;">
          <!-- Kartlar dinamik eklenecek -->
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    this.modal = overlay;

    // Events
    const btnClose = overlay.querySelector('#btn-close-vocab');
    btnClose.addEventListener('click', () => this.hide());
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) this.hide();
    });

    // Search input
    const searchInput = overlay.querySelector('#vocab-search');
    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase().trim();
      this.renderLimit = 60;
      this._applyFilter();
    });

    // Level chips
    const levelChips = overlay.querySelectorAll('.vocab-level-chips .hint-chip');
    levelChips.forEach(chip => {
      chip.addEventListener('click', () => {
        levelChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.currentLevel = chip.dataset.level;
        this.renderLimit = 60;
        this._applyFilter();
      });
    });

    // Sonsuz kaydırma (Infinite Scroll)
    const listContainer = overlay.querySelector('#vocab-list-container');
    listContainer.addEventListener('scroll', () => {
      if (listContainer.scrollTop + listContainer.clientHeight >= listContainer.scrollHeight - 100) {
        if (this.renderLimit < this.filteredWords.length) {
          this.renderLimit += 60;
          this._renderList(false);
        }
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.modal && this.modal.classList.contains('open')) {
        this.hide();
      }
    });
  }

  async show() {
    this.modal.classList.add('open');
    if (this.words.length === 0) {
      await this.loadWords();
    } else {
      this._renderList(true);
    }
  }

  hide() {
    this.modal.classList.remove('open');
  }

  async loadWords() {
    const listContainer = this.modal.querySelector('#vocab-list-container');
    listContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.6);">Kelimeler Supabase veritabanından yükleniyor...</div>';

    this.isLoading = true;
    this.words = await fetchWordsFromSupabase();
    this.isLoading = false;

    this.renderLimit = 60;
    this._applyFilter();
  }

  _applyFilter() {
    this.filteredWords = this.words.filter(w => {
      const matchLevel = this.currentLevel === 'Tümü' || w.seviye === this.currentLevel;
      const matchSearch = !this.searchQuery || 
        (w.almanca && w.almanca.toLowerCase().includes(this.searchQuery)) ||
        (w.turkce && w.turkce.toLowerCase().includes(this.searchQuery)) ||
        (w.kategori && w.kategori.toLowerCase().includes(this.searchQuery));
      return matchLevel && matchSearch;
    });

    this._renderList(true);
  }

  _renderList(reset = true) {
    const listContainer = this.modal.querySelector('#vocab-list-container');
    const countLabel = this.modal.querySelector('#vocab-count-label');
    const learnedLabel = this.modal.querySelector('#vocab-learned-label');

    const totalLearned = this.words.filter(w => w.ogrenilen_kelimeler && w.ogrenilen_kelimeler[0]?.durum === 'ogrenildi').length;
    countLabel.textContent = `Toplam: ${this.words.length} kelime (Filtrelenen: ${this.filteredWords.length})`;
    learnedLabel.textContent = `⭐ Öğrenildi: ${totalLearned}`;

    if (this.filteredWords.length === 0) {
      listContainer.innerHTML = '<div style="text-align: center; padding: 40px; color: rgba(255,255,255,0.5);">Aramanızla eşleşen kelime bulunamadı.</div>';
      return;
    }

    if (reset) {
      listContainer.innerHTML = '';
    }

    const startIdx = reset ? 0 : listContainer.children.length;
    const itemsToRender = this.filteredWords.slice(startIdx, this.renderLimit);

    itemsToRender.forEach(word => {
      const card = document.createElement('div');
      card.className = 'vocab-card';
      card.style.cssText = `
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid rgba(255, 255, 255, 0.08);
        border-radius: 10px;
        padding: 12px 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        transition: transform 0.15s ease, border-color 0.15s ease;
      `;

      const isLearned = word.ogrenilen_kelimeler && word.ogrenilen_kelimeler[0]?.durum === 'ogrenildi';
      if (isLearned) {
        card.style.borderColor = 'rgba(46, 204, 113, 0.3)';
        card.style.background = 'rgba(46, 204, 113, 0.03)';
      }

      let articleBadge = '';
      if (word.artikel) {
        const artClass = `art-${word.artikel.toLowerCase()}`;
        articleBadge = `<span class="${artClass}" style="font-weight: 700; margin-right: 4px;">${word.artikel}</span>`;
      }

      // Seviye rengi
      let levelColor = '#60a5fa'; // default A1/A2
      if (word.seviye === 'B1') levelColor = '#a78bfa';
      if (word.seviye === 'B2') levelColor = '#f59e0b';

      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center;';
      headerRow.innerHTML = `
        <div style="font-size: 1.05rem; font-weight: 600; display: flex; align-items: center; flex-wrap: wrap; gap: 4px;">
          ${articleBadge}
          <span style="color: #fff;">${word.almanca}</span>
          ${word.pos ? `<span style="font-size: 0.7rem; color: rgba(255,255,255,0.4); padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.06);">${word.pos.split('(')[0].trim()}</span>` : ''}
          <span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); color: ${levelColor}; font-weight: bold;">${word.seviye || 'A1'}</span>
        </div>
        <div style="display: flex; gap: 6px; flex-shrink: 0;">
          <button class="bubble-action-btn btn-tts-vocab" title="Telaffuzu Dinle" style="padding: 4px 8px; font-size: 0.9rem;">🔊</button>
          <button class="bubble-action-btn btn-toggle-learn" title="${isLearned ? 'Öğrenildi olarak işaretli (Tıkla kaldır)' : 'Öğrenildi olarak işaretle'}" style="padding: 4px 8px; font-size: 0.85rem; color: ${isLearned ? '#2ecc71' : 'rgba(255,255,255,0.4)'};">
            ${isLearned ? '⭐ Öğrenildi' : '☆ Öğren'}
          </button>
        </div>
      `;

      const meaningRow = document.createElement('div');
      meaningRow.style.cssText = 'color: #94a3b8; font-size: 0.9rem; font-weight: 500;';
      meaningRow.textContent = `🇹🇷 ${word.turkce}`;

      let exampleRow = null;
      if (word.ornek_cumle) {
        exampleRow = document.createElement('div');
        exampleRow.style.cssText = 'font-size: 0.82rem; color: rgba(255,255,255,0.7); background: rgba(0,0,0,0.18); padding: 6px 10px; border-radius: 6px; border-left: 2px solid #3b82f6; margin-top: 2px;';
        exampleRow.innerHTML = `
          <div>🇩🇪 <em>${word.ornek_cumle}</em></div>
          ${word.ornek_ceviri ? `<div style="color: rgba(255,255,255,0.5); margin-top: 2px;">🇹🇷 ${word.ornek_ceviri}</div>` : ''}
        `;
      }

      card.appendChild(headerRow);
      card.appendChild(meaningRow);
      if (exampleRow) card.appendChild(exampleRow);

      const btnTTS = card.querySelector('.btn-tts-vocab');
      btnTTS.addEventListener('click', (e) => {
        e.stopPropagation();
        this._playTTS(word.artikel ? `${word.artikel} ${word.almanca}` : word.almanca);
      });

      const btnToggle = card.querySelector('.btn-toggle-learn');
      btnToggle.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentStatus = word.ogrenilen_kelimeler && word.ogrenilen_kelimeler[0]?.durum === 'ogrenildi' ? 'ogrenildi' : 'ogreniliyor';
        const newStatus = await toggleWordLearnedStatus(word.id, currentStatus);
        
        if (!word.ogrenilen_kelimeler) word.ogrenilen_kelimeler = [{}];
        word.ogrenilen_kelimeler[0].durum = newStatus;
        this._renderList(true);
      });

      listContainer.appendChild(card);
    });
  }

  _playTTS(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'de-DE';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }
}
