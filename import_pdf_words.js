import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mvqazwfyaxnhjunemanr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im12cWF6d2Z5YXhuaGp1bmVtYW5yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMTkyNjYsImV4cCI6MjEwODc5NTI2Nn0.v8QNMEW6ybfmUM6IWkS3NNJNSH76mF1izpx9j4F5-Mw';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const PDF_PATH = './pdf/A1_B2_Kelime_Listesi.pdf';

async function parseAndImport() {
  console.log('PDF okunuyor:', PDF_PATH);
  const dataBuffer = fs.readFileSync(PDF_PATH);
  const parser = new PDFParse({ data: dataBuffer });
  const result = await parser.getText();
  
  console.log(`PDF toplam sayfa: ${result.pages.length}`);

  const words = [];
  
  for (let pageIdx = 0; pageIdx < result.pages.length; pageIdx++) {
    const pageNum = pageIdx + 1;
    let level = null;

    if (pageNum >= 5 && pageNum <= 13) level = 'A1';
    else if (pageNum >= 15 && pageNum <= 27) level = 'A2';
    else if (pageNum >= 29 && pageNum <= 48) level = 'B1';
    else if (pageNum >= 50 && pageNum <= 96) level = 'B2';

    if (!level) continue; // Kapak ve ara sayfaları atla

    const pageText = result.pages[pageIdx].text || '';
    const lines = pageText.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    let currentEntry = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Üst/alt bilgileri ve sayfa numaralarını atla
      if (line.includes('KELİME LİSTESİ') || 
          line.includes('ÖSD • GOETHE • TELC') || 
          line.includes('Almanca Kelime Listesi') ||
          /^\d+$/.test(line) ||
          /^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) {
        continue;
      }

      // Kelime eşleşmesi: "Kelime — Anlamı" (em-dash, en-dash, normal dash)
      const match = line.match(/^([^\u2014\u2013\-]+)\s*[\u2014\u2013\-]\s*(.+)$/);
      if (match && !line.startsWith('Bsp.')) {
        if (currentEntry) {
          words.push(currentEntry);
        }

        currentEntry = {
          almanca: match[1].trim(),
          turkce: match[2].trim(),
          ornek_cumle: '',
          seviye: level,
          kategori: 'Genel'
        };
        continue;
      }

      // Örnek cümle kontrolü
      if (currentEntry) {
        if (line.startsWith('Bsp.')) {
          currentEntry.ornek_cumle = line.replace(/^Bsp\.\s*/, '').trim();
        } else if (currentEntry.ornek_cumle && !match) {
          currentEntry.ornek_cumle += ' ' + line;
        }
      }
    }

    if (currentEntry) {
      words.push(currentEntry);
    }
  }

  console.log(`\nToplam ayıklanan kelime: ${words.length}`);
  const counts = { A1: 0, A2: 0, B1: 0, B2: 0 };
  words.forEach(w => counts[w.seviye] = (counts[w.seviye] || 0) + 1);
  console.log('Seviye Dağılımı:', counts);

  // Veritabanındaki mevcut kelimeleri çek
  console.log('\nSupabase mevcut kelimeler taranıyor...');
  const { data: existingWords, error: fetchErr } = await supabase
    .from('kelimeler')
    .select('almanca');

  if (fetchErr) {
    console.warn('Mevcut kelimeler alınamadı:', fetchErr.message);
  }

  const existingSet = new Set((existingWords || []).map(w => w.almanca.toLowerCase().trim()));
  console.log(`Veritabanında halihazırda ${existingSet.size} kelime var.`);

  const toInsert = words.filter(w => !existingSet.has(w.almanca.toLowerCase().trim()));
  console.log(`Eklenecek yeni kelime sayısı: ${toInsert.length}`);

  if (toInsert.length === 0) {
    console.log('Tüm kelimeler zaten veritabanında mevcut!');
    return;
  }

  // 200'lük paketler halinde aktar
  const BATCH_SIZE = 200;
  let insertedTotal = 0;

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error: insErr } = await supabase
      .from('kelimeler')
      .insert(batch);

    if (insErr) {
      console.error(`Paket ${Math.floor(i / BATCH_SIZE) + 1} eklenirken hata:`, insErr.message);
    } else {
      insertedTotal += batch.length;
      console.log(`Yüklendi: ${insertedTotal} / ${toInsert.length} (%${Math.round(insertedTotal / toInsert.length * 100)})`);
    }
  }

  console.log(`\nTEBRİKLER! Toplam ${insertedTotal} yeni kelime Supabase veritabanına aktarıldı.`);
}

parseAndImport().catch(err => {
  console.error('Beklenmeyen hata:', err);
});
