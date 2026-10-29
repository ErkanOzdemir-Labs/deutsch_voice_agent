// ============================================
// DeutschVoice Agent — IndexedDB & Supabase Audio Storage
// ============================================

import { saveAudioToSupabase, getAudioFromSupabase } from '../services/supabase-service.js';

const DB_NAME = 'dv_audio_db';
const DB_VERSION = 1;
const STORE_NAME = 'audio_store';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAudio(id, float32Array) {
  // 1. IndexedDB'ye yerel olarak hızlıca kaydet
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(float32Array, id);
    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);
  });

  // 2. Supabase bulut veritabanına asenkron yedekle
  saveAudioToSupabase(id, float32Array).catch(err => {
    console.warn('[AudioDB] Supabase audio save error:', err);
  });

  return id;
}

export async function getAudio(id) {
  if (!id) return null;
  
  // 1. Önce yerel IndexedDB'den kontrol et
  try {
    const db = await openDB();
    const localData = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    if (localData) return localData;
  } catch (e) {
    console.warn('[AudioDB] Local IndexedDB read error:', e);
  }

  // 2. Yerelde yoksa Supabase bulut veritabanından çek ve yerele önbellekle
  try {
    const cloudData = await getAudioFromSupabase(id);
    if (cloudData) {
      // Yerel IndexedDB'ye kaydet ki tekrar internetten çekmesin
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(cloudData, id);
      return cloudData;
    }
  } catch (e) {
    console.warn('[AudioDB] Supabase audio read error:', e);
  }

  return null;
}

export async function deleteAudio(id) {
  if (!id) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllAudio() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
