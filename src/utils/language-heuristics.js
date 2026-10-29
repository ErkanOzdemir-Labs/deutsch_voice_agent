export const trStopWords = new Set([
  've','bir','bu','şu','o','ile','için','ne','nasıl','neden','kim','ben','sen','biz','siz','onlar',
  'evet','hayır','çok','daha','gibi','ama','fakat','veya','ki','da','de','mı','mi','mu','mü',
  'tamam','teşekkürler','olarak','içinde','göre','sonra','önce','çünkü','ise','var','yok',
  'değil','oldu','olacak','yap','git','gel','iyi','kötü','şimdi','bunu','şunu','onu',
  'merhaba','nasılsın','teşekkür','ederim','lütfen','doğru','yanlış','anladım','anlıyorum',
  'söyle','dedi','örnek', 'şey', 'diye', 'kadar', 'zaman', 'en', 'hiç', 'öyle', 'böyle', 
  'şöyle', 'başka', 'zaten', 'belki', 'yine', 'hem', 'sadece', 'bütün', 'tüm', 'her', 'hiçbir', 
  'bazı', 'biri', 'kimi', 'hepsi', 'herkes', 'kimse', 'olur', 'olmaz', 'olabilir', 'gerek', 
  'lazım', 'istiyorum', 'ediyor', 'edecek', 'etti', 'yani', 'mesela', 'örneğin', 'şayet',
  'eğer', 'bazen', 'sürekli', 'asla', 'yoksa', 'tabii', 'elbette', 'galiba', 'sanki',
  'şu', 'şu', 'bizim', 'sizin', 'benim', 'senin', 'onun', 'onların', 'bana', 'sana', 'ona', 'bize', 'size', 'onlara',
  'beni', 'seni', 'onu', 'bizi', 'sizi', 'onları', 'burada', 'şurada', 'orada', 'nerede', 'buraya', 'şuraya', 'oraya', 'nereye'
]);

export const deStopWords = new Set([
  'und','ein','eine','der','die','das','ist','ich','du','er','sie','es','wir','ihr','ja',
  'nein','sehr','mehr','wie','aber','oder','dass','ob','nicht','kein','auch','mit','zu',
  'von','in','auf','für','an','als','bei','nach','hallo','danke','bitte','gut','schlecht',
  'richtig','falsch','beispiel','sagen','machen', 'bin', 'bist', 'sind', 'seid', 'war', 
  'warst', 'waren', 'wart', 'habe', 'hast', 'hat', 'haben', 'habt', 'hatte', 'hatten',
  'was', 'wer', 'wo', 'wann', 'warum', 'wie', 'welche', 'welcher', 'welches', 'welchen', 'welchem',
  'mein', 'dein', 'sein', 'ihr', 'unser', 'euer', 'ihre', 'meine', 'deine', 'seine', 'unsere', 'eure',
  'mich', 'dich', 'sich', 'uns', 'euch', 'mir', 'dir', 'ihm', 'ihnen',
  'hier', 'da', 'dort', 'jetzt', 'heute', 'morgen', 'gestern', 'immer', 'nie', 'oft', 'selten', 'manchmal'
]);

const NOT_GERMAN_KEY = 'deutsch_voice_not_german';

function loadNotGermanWords() {
  try {
    const data = localStorage.getItem(NOT_GERMAN_KEY);
    if (data) return new Set(JSON.parse(data));
  } catch(e) {}
  return new Set();
}

export const notGermanWords = loadNotGermanWords();

export function addNotGermanWord(word) {
  notGermanWords.add(word.toLowerCase());
  try {
    localStorage.setItem(NOT_GERMAN_KEY, JSON.stringify(Array.from(notGermanWords)));
  } catch(e) {}
}

export function isGermanWord(w) {
  const wLower = w.toLowerCase();
  
  if (notGermanWords.has(wLower)) return false;
  
  // Kesin Türkçe harfler varsa (Büyük/Küçük harf olarak kontrol)
  if (/[şçğıŞÇĞİ]/.test(w)) return false;
  
  // Kesin Almanca harfler varsa
  if (/[äöüßÄÖÜ]/.test(w)) return true;
  
  // Özel kelimeleri kontrol et
  if (trStopWords.has(wLower)) return false;
  if (deStopWords.has(wLower)) return true;
  
  // Baş harfi büyükse isim olma ihtimali yüksek (Almanca özelliği)
  // Sadece A-Z kontrolü yapıyoruz, çünkü Türkçe "I" vs karışabilir ama genelde güvenli
  if (/^[A-ZÄÖÜ]/.test(w)) return true;
  
  // Sık kullanılan Almanca ekler
  if (/(ung|heit|keit|schaft|tion|ismus|ig|lich|isch|bar|haft|los|chen|lein)$/.test(wLower)) return true;
  
  // Sık kullanılan Almanca ön ekler (uzunluk kontrolü ile)
  if (/^(ver|be|ge|er|zer|ent|emp|miss)/.test(wLower) && wLower.length >= 6) return true;
  
  // Sık kullanılan Türkçe ekler (kaba bir tahmin)
  if (/(lar|ler|mak|mek|yor|dığı|diği|ecek|acak|mış|miş|dır|dir|dur|dür)$/.test(wLower) && wLower.length >= 5) return false;

  // Varsayılan olarak eğer çok şüpheli değilse true dönüyoruz ki
  // normal Almanca kelimeler kaçırılmasın.
  return true;
}
