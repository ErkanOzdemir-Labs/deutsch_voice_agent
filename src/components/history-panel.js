// ============================================
// DeutschVoice Agent — History Panel Component
// ============================================

import { loadConversations, deleteConversation, createConversation, setActiveConversationId } from '../utils/storage.js';

export class HistoryPanel {
  constructor() {
    this.panel = document.getElementById('history-panel');
    this.overlay = document.getElementById('history-overlay');
    this.list = document.getElementById('history-list');
    this.btnOpen = document.getElementById('btn-history');
    this.btnClose = document.getElementById('btn-close-history');
    this.btnNew = document.getElementById('btn-new-chat');

    this._onSelectConversation = null;
    this._onNewChat = null;

    this._bindEvents();
  }

  set onSelectConversation(fn) { this._onSelectConversation = fn; }
  set onNewChat(fn) { this._onNewChat = fn; }

  _bindEvents() {
    this.btnOpen.addEventListener('click', () => this.open());
    this.btnClose.addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', () => this.close());

    this.btnNew.addEventListener('click', () => {
      const conv = createConversation();
      this.render(conv.id);
      this.close();
      if (this._onNewChat) this._onNewChat(conv);
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.panel.classList.contains('open')) {
        this.close();
      }
    });
  }

  /**
   * Render the conversation list
   * @param {string} [activeId] - Currently active conversation ID
   */
  render(activeId) {
    const conversations = loadConversations();
    this.list.innerHTML = '';

    if (conversations.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 0.85rem;';
      empty.textContent = 'Henüz sohbet yok. Yeni bir sohbet başlat!';
      this.list.appendChild(empty);
      return;
    }

    conversations.forEach(conv => {
      const item = document.createElement('div');
      item.className = `history-item${conv.id === activeId ? ' active' : ''}`;

      const text = document.createElement('div');
      text.className = 'history-item-text';

      const title = document.createElement('div');
      title.className = 'history-item-title';
      title.textContent = conv.title;

      const date = document.createElement('div');
      date.className = 'history-item-date';
      date.textContent = this._formatDate(conv.updatedAt);

      text.appendChild(title);
      text.appendChild(date);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn history-item-delete';
      deleteBtn.textContent = '🗑️';
      deleteBtn.title = 'Sohbeti sil';
      deleteBtn.style.cssText = 'width: 28px; height: 28px; font-size: 0.8rem;';

      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Bu sohbet silinecek. Emin misiniz?')) {
          deleteConversation(conv.id);
          this.render(activeId === conv.id ? null : activeId);
          if (conv.id === activeId && this._onNewChat) {
            const newConv = createConversation();
            this._onNewChat(newConv);
          }
        }
      });

      item.addEventListener('click', () => {
        setActiveConversationId(conv.id);
        this.render(conv.id);
        this.close();
        if (this._onSelectConversation) this._onSelectConversation(conv);
      });

      item.appendChild(text);
      item.appendChild(deleteBtn);
      this.list.appendChild(item);
    });
  }

  open() {
    this.panel.classList.add('open');
    this.overlay.classList.add('open');
  }

  close() {
    this.panel.classList.remove('open');
    this.overlay.classList.remove('open');
  }

  _formatDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Az önce';
    if (minutes < 60) return `${minutes} dk önce`;
    if (hours < 24) return `${hours} saat önce`;
    if (days < 7) return `${days} gün önce`;
    return date.toLocaleDateString('tr-TR');
  }
}
