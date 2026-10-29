// ============================================
// DeutschVoice Agent — Smart Dictionary Service
// DB-First with Automatic AI Enrichment
// ============================================

import { supabase } from './supabase-service.js';

const DICT_CACHE_KEY = 'deutsch_voice_wordbank';

function getWordBank() {
  try {
    const cached = localStorage.getItem(DICT_CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch (e) {
    console.warn('WordBank parse error', e);
  }
  return {};
}

function saveToWordBank(word, data) {
  const bank = getWordBank();
  bank[word.toLowerCase()] = data;
  try {
    localStorage.setItem(DICT_CACHE_KEY, JSON.stringify(bank));
  } catch (e) {
    console.warn('WordBank save error', e);
  }
}

/**
 * Supabase'deki mevcut tüm kelimeleri yerel önbelleğe senkronize eder
 */
export async function syncWordBankWithSupabase() {
  try {
    const { data: words, error } = await supabase
      .from('kelimeler')
      .select('*');

    if (error || !words) return;

    const bank = getWordBank();
    words.forEach(w => {
      const wLower = w.almanca.toLowerCase();
      // Yalnızca yerelde hiç yoksa veya yereldeki eksik, DB'deki daha doluysa güncelle
      if (!bank[wLower] || (w.artikel && !bank[wLower].article)) {
        bank[wLower] = {
          pos: w.pos || (w.artikel ? 'Nomen / Substantiv (İsim)' : ''),
          article: w.artikel || '',
          singular: w.singular || (w.artikel ? w.almanca : ''),
          plural: w.plural || '',
          infinitive: w.infinitive || '',
          trTranslation: w.turkce || '',
          derivations: w.derivations || [],
          ornek_cumle: w.ornek_cumle,
          ornek_ceviri: w.ornek_ceviri
        };
      }
    });

    localStorage.setItem(DICT_CACHE_KEY, JSON.stringify(bank));
  } catch (err) {
    console.warn('[Dictionary] syncWordBankWithSupabase error:', err);
  }
}

/**
 * Kelime detaylarını getirir:
 * 1. Önce DB'ye bakar ve var olan bilgileri alır.
 * 2. Eğer artikel/tür gibi bilgiler eksikse ve API Key varsa AI ile tamamlayıp DB'ye işler.
 * 3. Eğer API Key yoksa DB'deki mevcut bilgileri döner.
 */
export async function fetchWordDetails(word, apiKey, forceUpdate = false) {
  const wLower = word.toLowerCase();
  
  // 1. Önce DB'den kelimeyi ara
  let dbWord = null;
  try {
    const { data: dbWords } = await supabase
      .from('kelimeler')
      .select('*')
      .ilike('almanca', word)
      .limit(1);

    if (dbWords && dbWords.length > 0) {
      dbWord = dbWords[0];
    }
  } catch (e) {
    console.warn('[Dictionary] Supabase read error:', e);
  }

  // Veritabanında tam dolu mu? (Tür ve Nomen ise Artikel var mı?)
  const isNoun = dbWord && dbWord.almanca && /^[A-ZÄÖÜ]/.test(dbWord.almanca);
  const hasArticle = dbWord && dbWord.artikel && dbWord.artikel.trim().length > 0;
  const hasPos = dbWord && dbWord.pos && dbWord.pos.trim().length > 0;

  const isComplete = dbWord && hasPos && (!isNoun || hasArticle);

  // Eğer veritabanında tüm bilgiler tamsa ve forceUpdate istenmediyse direkt dön
  if (dbWord && isComplete && !forceUpdate) {
    const formatted = {
      pos: dbWord.pos,
      article: dbWord.artikel || '',
      singular: dbWord.singular || (dbWord.artikel ? dbWord.almanca : ''),
      plural: dbWord.plural || '',
      infinitive: dbWord.infinitive || '',
      trTranslation: dbWord.turkce || '',
      derivations: dbWord.derivations || [],
      ornek_cumle: dbWord.ornek_cumle,
      ornek_ceviri: dbWord.ornek_ceviri
    };
    saveToWordBank(wLower, formatted);
    return formatted;
  }

  // Eğer eksik bilgi varsa fakat Gemini API anahtarı yoksa, DB'deki mevcut bilgileri göster
  if (!apiKey) {
    if (dbWord) {
      return {
        pos: dbWord.pos || (isNoun ? 'Nomen / Substantiv (İsim)' : 'Wort'),
        article: dbWord.artikel || '',
        singular: dbWord.singular || dbWord.almanca,
        plural: dbWord.plural || '',
        infinitive: dbWord.infinitive || '',
        trTranslation: dbWord.turkce || '',
        derivations: dbWord.derivations || [],
        ornek_cumle: dbWord.ornek_cumle,
        ornek_ceviri: dbWord.ornek_ceviri
      };
    }
    throw new Error('Bu kelime veritabanında yok. AI ile analiz etmek için Ayarlar menüsünden Gemini API anahtarınızı girin.');
  }

  // 2. Eksik bilgileri AI (Gemini) ile analiz et
  const prompt = `
Analyze the German word: "${dbWord ? dbWord.almanca : word}"
Existing context:
- Turkish translation: "${dbWord ? dbWord.turkce : ''}"
- Example sentence: "${dbWord ? dbWord.ornek_cumle : ''}"

CRITICAL RULES:
1. If this word is NOT a valid German word, you MUST return exactly "NOT_GERMAN" for the "pos" field.
2. If it IS a valid German word, provide its exact details.
3. Pay strict attention to CAPITALIZATION. In German, ALL nouns are capitalized.
4. If it's a noun, provide its definite singular article: "der", "die", or "das".
5. Return derivations if any.

Return a strict JSON object with:
- "pos": EXACTLY one of: "Nomen / Substantiv (İsim)", "Verb (Fiil)", "Adjektiv (Sıfat)", "Adverb (Zarf)", "Pronomen (Zamir)", "Präposition (Edat)", "Konjunktion (Bağlaç)", "Artikel (Artikel)", "Interjektion (Ünlem)", or "NOT_GERMAN".
- "article": For nouns, exactly "der", "die", or "das" (or "der-die-das"). Otherwise empty string "".
- "singular": For nouns, singular form. Otherwise "".
- "plural": For nouns, plural form. Otherwise "".
- "infinitive": For verbs, infinitive form. Otherwise "".
- "trTranslation": Turkish meaning (keep concise).
- "derivations": Array of { "label": string, "text": string }.

Respond ONLY with JSON.
  `.trim();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    // API hatası olsa dahi eğer DB'de kelime varsa onu göster
    if (dbWord) {
      return {
        pos: dbWord.pos || (isNoun ? 'Nomen / Substantiv (İsim)' : 'Wort'),
        article: dbWord.artikel || '',
        singular: dbWord.singular || dbWord.almanca,
        plural: dbWord.plural || '',
        infinitive: dbWord.infinitive || '',
        trTranslation: dbWord.turkce || '',
        derivations: dbWord.derivations || [],
        ornek_cumle: dbWord.ornek_cumle,
        ornek_ceviri: dbWord.ornek_ceviri
      };
    }
    throw new Error(`AI Servis Hatası: ${response.status}`);
  }

  const data = await response.json();
  let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
  if (rawText.startsWith('```json')) {
    rawText = rawText.replace(/^```json/, '').replace(/```$/, '').trim();
  }

  const parsed = JSON.parse(rawText);

  // Birleştirilmiş veri
  const finalResult = {
    pos: parsed.pos || dbWord?.pos || '',
    article: parsed.article || dbWord?.artikel || '',
    singular: parsed.singular || dbWord?.singular || (parsed.article ? word : ''),
    plural: parsed.plural || dbWord?.plural || '',
    infinitive: parsed.infinitive || dbWord?.infinitive || '',
    trTranslation: dbWord?.turkce || parsed.trTranslation || '',
    derivations: parsed.derivations || dbWord?.derivations || [],
    ornek_cumle: dbWord?.ornek_cumle || '',
    ornek_ceviri: dbWord?.ornek_ceviri || ''
  };

  saveToWordBank(wLower, finalResult);

  // 3. Veritabanını güncelle / ekle
  if (parsed.pos !== 'NOT_GERMAN') {
    if (dbWord) {
      // Var olan kaydı eksik bilgilerle güncelle
      supabase
        .from('kelimeler')
        .update({
          artikel: finalResult.article,
          pos: finalResult.pos,
          singular: finalResult.singular,
          plural: finalResult.plural,
          infinitive: finalResult.infinitive,
          derivations: finalResult.derivations
        })
        .eq('id', dbWord.id)
        .then(() => console.log(`[DB Enrich] ${word} güncellendi.`))
        .catch(e => console.warn('[DB Enrich] Update error:', e));
    } else {
      // Yeni kelime olarak ekle
      supabase
        .from('kelimeler')
        .insert({
          almanca: word,
          artikel: finalResult.article,
          turkce: finalResult.trTranslation,
          pos: finalResult.pos,
          singular: finalResult.singular,
          plural: finalResult.plural,
          infinitive: finalResult.infinitive,
          derivations: finalResult.derivations,
          seviye: 'A1',
          kategori: 'Sözlük'
        })
        .then(() => console.log(`[DB Insert] Yeni kelime ${word} eklendi.`))
        .catch(e => console.warn('[DB Insert] Insert error:', e));
    }
  }

  return finalResult;
}
