// ============================================
// DeutschVoice Agent — Storage Utilities with Supabase Sync
// ============================================

import { DEFAULT_SETTINGS } from './constants.js';
import { deleteAudio, clearAllAudio } from './audioDB.js';
import {
  syncConversationToSupabase,
  fetchConversationsFromSupabase,
  deleteConversationFromSupabase,
  saveMessageToSupabase,
  updateMessageTranslationInSupabase,
  deleteMessageFromSupabase
} from '../services/supabase-service.js';

const KEYS = {
  SETTINGS: 'dv_settings',
  CONVERSATIONS: 'dv_conversations',
  ACTIVE_CONVERSATION: 'dv_active_conversation'
};

// --- Settings ---

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEYS.SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw);
    
    // Clean up legacy keys
    const legacyKeys = ['openaiKey', 'elevenlabsKey', 'azureKey', 'groqKey', 'sttEngine', 'llmEngine', 'ttsEngine', 'agentMode', 'playTR', 'playDE', 'autoTTS'];
    legacyKeys.forEach(k => delete saved[k]);

    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('[Storage] Failed to save settings:', e);
  }
}

// --- Conversations ---

export function loadConversations() {
  try {
    const raw = localStorage.getItem(KEYS.CONVERSATIONS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function saveConversations(conversations) {
  try {
    localStorage.setItem(KEYS.CONVERSATIONS, JSON.stringify(conversations));
  } catch (e) {
    console.error('[Storage] Failed to save conversations:', e);
  }
}

export function getActiveConversationId() {
  return localStorage.getItem(KEYS.ACTIVE_CONVERSATION) || null;
}

export function setActiveConversationId(id) {
  if (id) {
    localStorage.setItem(KEYS.ACTIVE_CONVERSATION, id);
  } else {
    localStorage.removeItem(KEYS.ACTIVE_CONVERSATION);
  }
}

export function createConversation() {
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const conversation = {
    id,
    title: 'Yeni Sohbet',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: []
  };

  const conversations = loadConversations();
  conversations.unshift(conversation);
  saveConversations(conversations);
  setActiveConversationId(id);

  // Supabase ile asenkron senkronize et
  syncConversationToSupabase(conversation);

  return conversation;
}

export function updateConversation(id, updates) {
  const conversations = loadConversations();
  const idx = conversations.findIndex(c => c.id === id);
  if (idx === -1) return null;

  conversations[idx] = { ...conversations[idx], ...updates, updatedAt: Date.now() };
  saveConversations(conversations);

  // Supabase ile güncelle
  syncConversationToSupabase(conversations[idx]);

  return conversations[idx];
}

export function deleteConversation(id) {
  let conversations = loadConversations();
  
  const conv = conversations.find(c => c.id === id);
  if (conv) {
    conv.messages.forEach(m => {
      if (m.audioId) deleteAudio(m.audioId);
    });
  }

  conversations = conversations.filter(c => c.id !== id);
  saveConversations(conversations);

  if (getActiveConversationId() === id) {
    setActiveConversationId(conversations.length > 0 ? conversations[0].id : null);
  }

  // Supabase'den de sil
  deleteConversationFromSupabase(id);
}

export function clearAllConversations() {
  const conversations = loadConversations();
  conversations.forEach(c => deleteConversationFromSupabase(c.id));
  
  saveConversations([]);
  setActiveConversationId(null);
  clearAllAudio();
}

export function addMessage(conversationId, role, content, audioId = null) {
  const conversations = loadConversations();
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return;

  const message = { role, content, audioId, timestamp: Date.now() };
  conv.messages.push(message);
  conv.updatedAt = Date.now();

  // Update title from first user message
  if (role === 'user' && conv.title === 'Yeni Sohbet') {
    conv.title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
  }

  saveConversations(conversations);

  // Supabase'e kaydet
  saveMessageToSupabase(conversationId, message);

  return message;
}

export function deleteMessage(conversationId, content) {
  const conversations = loadConversations();
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return false;

  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].content === content) {
      const deletedMsg = conv.messages.splice(i, 1)[0];
      if (deletedMsg.audioId) {
        deleteAudio(deletedMsg.audioId);
      }
      conv.updatedAt = Date.now();
      saveConversations(conversations);

      // Supabase'den de sil
      deleteMessageFromSupabase(conversationId, content);
      return true;
    }
  }
  return false;
}

export function updateMessageTranslation(conversationId, content, translation) {
  const conversations = loadConversations();
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return;

  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].content === content) {
      conv.messages[i].translation = translation;
      saveConversations(conversations);

      // Supabase'deki çeviriyi güncelle
      updateMessageTranslationInSupabase(conversationId, content, translation);
      return true;
    }
  }
  return false;
}

export function updateMessageAudio(conversationId, content, audioId) {
  const conversations = loadConversations();
  const conv = conversations.find(c => c.id === conversationId);
  if (!conv) return;

  for (let i = conv.messages.length - 1; i >= 0; i--) {
    if (conv.messages[i].content === content) {
      conv.messages[i].audioId = audioId;
      saveConversations(conversations);
      return true;
    }
  }
  return false;
}

export function getConversationMessages(conversationId) {
  const conversations = loadConversations();
  const conv = conversations.find(c => c.id === conversationId);
  return conv ? conv.messages : [];
}

/**
 * Uygulama açılışında Supabase'deki konuşmaları yerel önbellek ile senkronize eder.
 */
export async function syncConversationsWithSupabase() {
  try {
    const cloudConvs = await fetchConversationsFromSupabase();
    if (!cloudConvs || cloudConvs.length === 0) return loadConversations();

    const localConvs = loadConversations();
    const map = new Map();

    // Önce yereldekileri haritaya ekle
    localConvs.forEach(c => map.set(c.id, c));

    // Buluttakileri ekle veya güncelle
    cloudConvs.forEach(c => {
      const local = map.get(c.id);
      if (!local || (c.updatedAt && c.updatedAt > local.updatedAt)) {
        map.set(c.id, c);
      }
    });

    const merged = Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
    saveConversations(merged);
    return merged;
  } catch (err) {
    console.warn('[Storage] Sync with Supabase error:', err);
    return loadConversations();
  }
}
