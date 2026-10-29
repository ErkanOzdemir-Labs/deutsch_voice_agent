// ============================================
// DeutschVoice Agent — Supabase Service
// ============================================

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mvqazwfyaxnhjunemanr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12cWF6d2Z5YXhuaGp1bmVtYW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMTkyNjYsImV4cCI6MjEwODc5NTI2Nn0.v8QNMEW6ybfmUM6IWkS3NNJNSH76mF1izpx9j4F5-Mw';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Konuşma Oturumları (Conversations) ---

export async function syncConversationToSupabase(conv) {
  try {
    const { error } = await supabase
      .from('konusma_oturumlari')
      .upsert({
        id: conv.id,
        title: conv.title || 'Yeni Sohbet',
        updated_at: new Date(conv.updatedAt || Date.now()).toISOString()
      }, { onConflict: 'id' });

    if (error) console.warn('[Supabase] Oturum senkronizasyon hatası:', error.message);
  } catch (err) {
    console.warn('[Supabase] syncConversationToSupabase catch:', err);
  }
}

export async function fetchConversationsFromSupabase() {
  try {
    const { data: convs, error } = await supabase
      .from('konusma_oturumlari')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      console.warn('[Supabase] fetchConversations error:', error.message);
      return [];
    }

    if (!convs || convs.length === 0) return [];

    // Mesajları çek
    const { data: messages, error: msgError } = await supabase
      .from('konusma_gecmisi')
      .select('*')
      .order('created_at', { ascending: true });

    if (msgError) {
      console.warn('[Supabase] fetchMessages error:', msgError.message);
    }

    const messagesByConv = {};
    (messages || []).forEach(m => {
      if (!messagesByConv[m.conversation_id]) {
        messagesByConv[m.conversation_id] = [];
      }
      messagesByConv[m.conversation_id].push({
        role: m.role,
        content: m.content,
        translation: m.translation,
        audioId: m.audio_id,
        timestamp: m.timestamp ? Number(m.timestamp) : new Date(m.created_at).getTime()
      });
    });

    return convs.map(c => ({
      id: c.id,
      title: c.title,
      createdAt: new Date(c.created_at).getTime(),
      updatedAt: new Date(c.updated_at).getTime(),
      messages: messagesByConv[c.id] || []
    }));
  } catch (err) {
    console.warn('[Supabase] fetchConversationsFromSupabase catch:', err);
    return [];
  }
}

export async function deleteConversationFromSupabase(id) {
  try {
    const { error } = await supabase
      .from('konusma_oturumlari')
      .delete()
      .eq('id', id);

    if (error) console.warn('[Supabase] deleteConversation error:', error.message);
  } catch (err) {
    console.warn('[Supabase] deleteConversation catch:', err);
  }
}

// --- Mesajlar (Messages) ---

export async function saveMessageToSupabase(convId, message) {
  try {
    // Önce oturumun varlığından emin ol
    await supabase.from('konusma_oturumlari').upsert({
      id: convId,
      updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    const { error } = await supabase
      .from('konusma_gecmisi')
      .insert({
        conversation_id: convId,
        role: message.role,
        content: message.content,
        translation: message.translation || null,
        audio_id: message.audioId || null,
        timestamp: message.timestamp || Date.now()
      });

    if (error) console.warn('[Supabase] saveMessage error:', error.message);
  } catch (err) {
    console.warn('[Supabase] saveMessage catch:', err);
  }
}

export async function updateMessageTranslationInSupabase(convId, content, translation) {
  try {
    const { error } = await supabase
      .from('konusma_gecmisi')
      .update({ translation: translation })
      .eq('conversation_id', convId)
      .eq('content', content);

    if (error) console.warn('[Supabase] updateTranslation error:', error.message);
  } catch (err) {
    console.warn('[Supabase] updateTranslation catch:', err);
  }
}

export async function deleteMessageFromSupabase(convId, content) {
  try {
    const { error } = await supabase
      .from('konusma_gecmisi')
      .delete()
      .eq('conversation_id', convId)
      .eq('content', content);

    if (error) console.warn('[Supabase] deleteMessage error:', error.message);
  } catch (err) {
    console.warn('[Supabase] deleteMessage catch:', err);
  }
}

// --- Ses Verileri (Audio) ---

export async function saveAudioToSupabase(audioId, float32Array) {
  try {
    // Float32Array'i Array'e çevirip JSON string olarak kaydediyoruz
    const audioJson = JSON.stringify(Array.from(float32Array));
    const { error } = await supabase
      .from('ses_kayitlari')
      .upsert({
        audio_id: audioId,
        audio_data: audioJson
      }, { onConflict: 'audio_id' });

    if (error) console.warn('[Supabase] saveAudio error:', error.message);
  } catch (err) {
    console.warn('[Supabase] saveAudio catch:', err);
  }
}

export async function getAudioFromSupabase(audioId) {
  try {
    const { data, error } = await supabase
      .from('ses_kayitlari')
      .select('audio_data')
      .eq('audio_id', audioId)
      .single();

    if (error || !data || !data.audio_data) return null;
    const array = JSON.parse(data.audio_data);
    return new Float32Array(array);
  } catch (err) {
    console.warn('[Supabase] getAudio catch:', err);
    return null;
  }
}

// --- Kelimeler & Sözlük (Vocabulary) ---

export async function fetchWordsFromSupabase(seviye = null) {
  try {
    let allWords = [];
    let from = 0;
    const PAGE_SIZE = 1000;

    while (true) {
      let query = supabase
        .from('kelimeler')
        .select('*, ogrenilen_kelimeler(durum, tekrar_sayisi)')
        .order('almanca', { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (seviye && seviye !== 'Tümü') {
        query = query.eq('seviye', seviye);
      }

      const { data, error } = await query;
      if (error) {
        console.warn('[Supabase] fetchWords error:', error.message);
        break;
      }

      if (!data || data.length === 0) break;
      allWords.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    return allWords;
  } catch (err) {
    console.warn('[Supabase] fetchWords catch:', err);
    return [];
  }
}

export async function toggleWordLearnedStatus(kelimeId, currentStatus) {
  try {
    const newStatus = currentStatus === 'ogrenildi' ? 'ogreniliyor' : 'ogrenildi';
    const { error } = await supabase
      .from('ogrenilen_kelimeler')
      .upsert({
        kelime_id: kelimeId,
        durum: newStatus,
        son_tekrar: new Date().toISOString()
      }, { onConflict: 'kelime_id' });

    if (error) console.warn('[Supabase] toggleWordStatus error:', error.message);
    return newStatus;
  } catch (err) {
    console.warn('[Supabase] toggleWordStatus catch:', err);
    return currentStatus;
  }
}

// --- Tarayıcı Verilerini Supabase'e Aktarma (Migration) ---

export async function migrateLocalDataToSupabase() {
  const stats = { conversations: 0, messages: 0, audio: 0, words: 0 };

  // 1. Sohbetleri ve Mesajları Aktar
  try {
    const rawConvs = localStorage.getItem('dv_conversations');
    if (rawConvs) {
      const convs = JSON.parse(rawConvs);
      for (const conv of convs) {
        await syncConversationToSupabase(conv);
        stats.conversations++;

        if (conv.messages && conv.messages.length > 0) {
          for (const msg of conv.messages) {
            await saveMessageToSupabase(conv.id, msg);
            stats.messages++;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Migration] Konuşma aktarım hatası:', err);
  }

  // 2. IndexedDB'deki Sesleri Güvenli Şekilde Oku ve Aktar (TransactionInactiveError önleyici)
  try {
    const audioItems = await new Promise((resolve) => {
      const dbReq = indexedDB.open('dv_audio_db', 1);
      dbReq.onerror = () => resolve([]);
      dbReq.onsuccess = () => {
        const db = dbReq.result;
        if (!db.objectStoreNames.contains('audio_store')) {
          return resolve([]);
        }
        const tx = db.transaction('audio_store', 'readonly');
        const store = tx.objectStore('audio_store');
        const keysReq = store.getAllKeys();
        const valsReq = store.getAll();

        tx.oncomplete = () => {
          const keys = keysReq.result || [];
          const vals = valsReq.result || [];
          const items = [];
          for (let i = 0; i < keys.length; i++) {
            if (vals[i]) {
              items.push({ key: keys[i], val: vals[i] });
            }
          }
          resolve(items);
        };
        tx.onerror = () => resolve([]);
      };
    });

    // Transaction tamamen bittikten sonra Supabase'e aktar
    for (const item of audioItems) {
      try {
        await saveAudioToSupabase(item.key, item.val);
        stats.audio++;
      } catch (err) {
        console.warn('[Migration] Ses yükleme hatası:', err);
      }
    }
  } catch (err) {
    console.warn('[Migration] Ses aktarım hatası:', err);
  }

  // 3. Tarayıcı Sözlük Bankasını Aktar (WordBank)
  try {
    const rawBank = localStorage.getItem('deutsch_voice_wordbank');
    if (rawBank) {
      const bank = JSON.parse(rawBank);
      const entries = Object.entries(bank);
      console.log(`[Migration] Yerel hafızada ${entries.length} sözlük kelimesi bulundu.`);
      
      for (const [w, item] of entries) {
        if (!item || item.pos === 'NOT_GERMAN') continue;

        let displayWord = w;
        if (item.article && item.article !== '') {
          displayWord = (item.singular && item.singular !== '-') ? item.singular : (w.charAt(0).toUpperCase() + w.slice(1));
        }

        // Supabase'de var mı kontrol et
        const { data: existing } = await supabase
          .from('kelimeler')
          .select('id')
          .ilike('almanca', w)
          .limit(1);

        if (!existing || existing.length === 0) {
          const { error: insErr } = await supabase.from('kelimeler').insert({
            almanca: displayWord,
            artikel: item.article || '',
            turkce: item.trTranslation || '',
            pos: item.pos || '',
            singular: item.singular || '',
            plural: item.plural || '',
            infinitive: item.infinitive || '',
            derivations: item.derivations || [],
            seviye: 'A1',
            kategori: 'Sözlük'
          });
          if (!insErr) {
            stats.words++;
          } else {
            console.warn('[Migration] Kelime insert hatası:', insErr.message);
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Migration] Sözlük aktarım hatası:', err);
  }

  return stats;
}

