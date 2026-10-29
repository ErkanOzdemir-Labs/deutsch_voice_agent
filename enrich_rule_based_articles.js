import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mvqazwfyaxnhjunemanr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12cWF6d2Z5YXhuaGp1bmVtYW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMTkyNjYsImV4cCI6MjEwODc5NTI2Nn0.v8QNMEW6ybfmUM6IWkS3NNJNSH76mF1izpx9j4F5-Mw';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Kesin Almanca Dilbilgisi Kuralları
const DIE_SUFFIXES = [
  'ung', 'heit', 'keit', 'schaft', 'tion', 'tät', 'ik', 'ie', 'anz', 'enz', 'ur', 'ion'
];

const DAS_SUFFIXES = [
  'chen', 'lein', 'ment', 'um', 'tum', 'ma'
];

const DER_SUFFIXES = [
  'ismus', 'or', 'ist', 'ant', 'ent', 'ling'
];

const DER_WORDS = new Set([
  'montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag',
  'januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember',
  'frühling', 'sommer', 'herbst', 'winter',
  'morgen', 'mittag', 'abend'
]);

function detectArticleAndPos(word) {
  const w = word.trim();
  const wLower = w.toLowerCase();
  const isCapitalized = /^[A-ZÄÖÜ]/.test(w);

  let artikel = '';
  let pos = '';
  let infinitive = '';

  if (isCapitalized) {
    pos = 'Nomen / Substantiv (İsim)';

    // 1. Bilinen kesin Maskulin kelimeler
    if (DER_WORDS.has(wLower)) {
      artikel = 'der';
    }
    // 2. Die ekleri
    else if (DIE_SUFFIXES.some(s => wLower.endsWith(s))) {
      artikel = 'die';
    }
    // 3. Das ekleri
    else if (DAS_SUFFIXES.some(s => wLower.endsWith(s))) {
      artikel = 'das';
    }
    // 4. Der ekleri
    else if (DER_SUFFIXES.some(s => wLower.endsWith(s))) {
      artikel = 'der';
    }
  } else {
    // Küçük harfle başlayanlar
    if (wLower.endsWith('en') || wLower.endsWith('eln') || wLower.endsWith('ern')) {
      pos = 'Verb (Fiil)';
      infinitive = w;
    } else if (wLower.endsWith('ig') || wLower.endsWith('lich') || wLower.endsWith('isch') || 
               wLower.endsWith('bar') || wLower.endsWith('sam') || wLower.endsWith('haft') || 
               wLower.endsWith('los') || wLower.endsWith('voll')) {
      pos = 'Adjektiv (Sıfat)';
    } else if (wLower.endsWith('weise') || wLower.endsWith('wärts')) {
      pos = 'Adverb (Zarf)';
    }
  }

  return { artikel, pos, infinitive };
}

async function runEnrichment() {
  console.log('Veritabanındaki kelimeler taranıyor...');
  let words = [];
  let from = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('kelimeler')
      .select('id, almanca, artikel, pos, infinitive')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Kelimeler çekilemedi:', error.message);
      break;
    }
    if (!data || data.length === 0) break;
    words.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  console.log(`Toplam ${words.length} kelime inceleniyor...`);

  const updates = [];
  let detectedArticles = { der: 0, die: 0, das: 0 };
  let detectedPos = { 'Nomen / Substantiv (İsim)': 0, 'Verb (Fiil)': 0, 'Adjektiv (Sıfat)': 0, 'Adverb (Zarf)': 0 };

  for (const w of words) {
    // Zaten artikeli ve türü doluysa atla
    if (w.artikel && w.pos) continue;

    const res = detectArticleAndPos(w.almanca);
    let needUpdate = false;
    const updateObj = { id: w.id };

    if (!w.artikel && res.artikel) {
      updateObj.artikel = res.artikel;
      detectedArticles[res.artikel] = (detectedArticles[res.artikel] || 0) + 1;
      needUpdate = true;
    }

    if (!w.pos && res.pos) {
      updateObj.pos = res.pos;
      detectedPos[res.pos] = (detectedPos[res.pos] || 0) + 1;
      needUpdate = true;
    }

    if (!w.infinitive && res.infinitive) {
      updateObj.infinitive = res.infinitive;
      needUpdate = true;
    }

    if (needUpdate) {
      updates.push(updateObj);
    }
  }

  console.log(`\nTespit edilen kural eşleşmeleri:`);
  console.log(`- Toplam güncellenecek kelime: ${updates.length}`);
  console.log(`- Tespit Edilen Artikeller:`, detectedArticles);
  console.log(`- Tespit Edilen Türler:`, detectedPos);

  if (updates.length === 0) {
    console.log('Güncellenecek yeni kurallı kelime bulunamadı.');
    return;
  }

  console.log('\nSupabase veritabanı güncelleniyor...');
  let done = 0;
  // Tek tek veya küçük gruplarla güncelle
  for (const u of updates) {
    const { id, ...fields } = u;
    await supabase.from('kelimeler').update(fields).eq('id', id);
    done++;
    if (done % 200 === 0 || done === updates.length) {
      console.log(`İşlendi: ${done} / ${updates.length}`);
    }
  }

  console.log('\nBAŞARILI! Tüm kurallı kelimelerin artikel ve tür bilgileri veritabanına işlendi.');
}

runEnrichment().catch(err => {
  console.error('Hata:', err);
});
