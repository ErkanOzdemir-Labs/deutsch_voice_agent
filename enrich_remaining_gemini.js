import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mvqazwfyaxnhjunemanr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12cWF6d2Z5YXhuaGp1bmVtYW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMTkyNjYsImV4cCI6MjEwODc5NTI2Nn0.v8QNMEW6ybfmUM6IWkS3NNJNSH76mF1izpx9j4F5-Mw';
const GEMINI_API_KEY = process.argv[2] || 'AIzaSyAxZW9YMW6N0rmY2Us6e9C9f1ro0K-B7_0';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function callGemini(promptText, retries = 5) {
  const model = 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: promptText }] }],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: 'application/json'
          }
        })
      });

      if (res.status === 429) {
        console.warn(`[Rate Limit 429] Kota sınırına ulaşıldı, 12 saniye beklenip tekrar deneniyor (Deneme ${attempt}/${retries})...`);
        await new Promise(r => setTimeout(r, 12000));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Model ${model} HTTP ${res.status}: ${errText}`);
      }

      const data = await res.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!rawText) throw new Error('Boş Gemini yanıtı');
      return JSON.parse(rawText);
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Hata alındı (${err.message}), 5 saniye sonra tekrar deneniyor...`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

async function fetchUnprocessedWords() {
  console.log('Supabase kelimeler tablosu taranıyor...');
  let allWords = [];
  let from = 0;
  const PAGE_SIZE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('kelimeler')
      .select('id, almanca, turkce, pos, artikel')
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error('Supabase okuma hatası:', error);
      break;
    }
    if (!data || data.length === 0) break;

    allWords.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  // İşlenmesi gerekenler:
  // 1) Artikeli henüz olmayan VE fiil/sıfat/zarf olduğu kesinleşmemiş isimler
  // 2) pos bilgisi hiç olmayanlar
  const needed = allWords.filter(w => {
    // Zaten fiil, sıfat veya zarf olarak işaretlenmişse artikel gerekmez
    if (w.pos === 'Verb (Fiil)' || w.pos === 'Adjektiv (Sıfat)' || w.pos === 'Adverb (Zarf)') {
      return false;
    }
    // İsim ise ve artikeli yoksa işlenmeli
    if (w.pos === 'Nomen / Substantiv (İsim)' && !w.artikel) {
      return true;
    }
    // pos boşsa işlenmeli
    if (!w.pos) {
      return true;
    }
    return false;
  });

  return needed;
}

async function main() {
  console.log('=== YÖNTEM A: GEMINI İLE TOPLU KELİME & ARTİKEL ANALİZİ BAŞLATILIYOR ===');
  const wordsToProcess = await fetchUnprocessedWords();
  console.log(`İşlenecek eksik kayıt sayısı: ${wordsToProcess.length}`);

  if (wordsToProcess.length === 0) {
    console.log('Tüm kelimelerin artikel ve tür bilgileri zaten tamamlanmış!');
    return;
  }

  const BATCH_SIZE = 45;
  const totalBatches = Math.ceil(wordsToProcess.length / BATCH_SIZE);

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < wordsToProcess.length; i += BATCH_SIZE) {
    const batch = wordsToProcess.slice(i, i + BATCH_SIZE);
    const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

    console.log(`\n[Paket ${batchIndex}/${totalBatches}] ${batch.length} kelime Gemini'ye gönderiliyor...`);

    const promptList = batch.map(w => ({
      id: w.id,
      almanca: w.almanca,
      turkce: w.turkce
    }));

    const prompt = `Almanca kelimeleri dilbilgisi açısından analiz et.
Aşağıdaki JSON listesindeki her bir Almanca kelime için:
1. pos: Kelime türü ('Nomen / Substantiv (İsim)', 'Verb (Fiil)', 'Adjektiv (Sıfat)', 'Adverb (Zarf)', 'Präposition (Edat)', 'Pronomen (Zamir)', 'Sonstiges')
2. artikel: Eğer kelime Nomen (İsim) ise doğru artikel ('der', 'die', 'das'). Nomen değilse null.
3. singular: İsimse tekil hali (örn: 'der Tisch' veya 'die Blume'), değilse null.
4. plural: İsimse artikeliyle çoğul hali (örn: 'die Tische', 'die Blumen'), değilse null.

Girdi listesi:
${JSON.stringify(promptList, null, 2)}

Çıktıyı SADECE şu formatta geçerli bir JSON dizisi olarak döndür:
[
  {
    "id": "uuid",
    "pos": "Nomen / Substantiv (İsim)",
    "artikel": "der",
    "singular": "der Tisch",
    "plural": "die Tische"
  }
]`;

    try {
      const results = await callGemini(prompt);
      
      if (!Array.isArray(results)) {
        console.warn(`[Paket ${batchIndex}] Beklenen JSON dizisi gelmedi, atlanıyor.`);
        errorCount += batch.length;
        continue;
      }

      // Supabase'de güncelle
      const updatePromises = results.map(async item => {
        if (!item.id) return;
        const updateData = {};
        if (item.pos) updateData.pos = item.pos;
        if (item.artikel) {
          const art = item.artikel.toLowerCase().trim();
          if (['der', 'die', 'das'].includes(art)) {
            updateData.artikel = art;
          }
        }
        if (item.singular) updateData.singular = item.singular;
        if (item.plural) updateData.plural = item.plural;

        if (Object.keys(updateData).length > 0) {
          const { error } = await supabase
            .from('kelimeler')
            .update(updateData)
            .eq('id', item.id);
          
          if (!error) successCount++;
          else errorCount++;
        }
      });

      await Promise.all(updatePromises);
      console.log(`[Paket ${batchIndex}/${totalBatches}] Başarıyla güncellendi. (Toplam Başarılı: ${successCount})`);

      // Rate limit koruması: dakikada maks 14 istek (Google AI Studio limiti: 15 RPM)
      await new Promise(r => setTimeout(r, 4200));
    } catch (err) {
      console.error(`[Paket ${batchIndex}] Hata oluştu:`, err.message);
      errorCount += batch.length;
    }
  }

  console.log('\n=============================================');
  console.log(`ANALİZ TAMAMLANDI!`);
  console.log(`Başarıyla Güncellenen: ${successCount}`);
  console.log(`Hata/Atlanan: ${errorCount}`);
  console.log('=============================================');
}

main();
