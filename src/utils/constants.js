// ============================================
// DeutschVoice Agent — Constants & System Prompts
// ============================================

export const TOPIC_LABELS = {
  free: 'Serbest',
  restaurant: 'Restoran',
  travel: 'Seyahat',
  interview: 'İş Görüşmesi',
  daily: 'Günlük Yaşam',
  shopping: 'Alışveriş',
  health: 'Sağlık',
  education: 'Eğitim'
};

export const TOPIC_CONTEXTS = {
  free: '',
  restaurant: 'Kullanıcı bir restoranda sipariş vermek, menü sormak veya garsonla konuşmak istiyor. Sohbeti restoran ortamında tut.',
  travel: 'Kullanıcı seyahat ediyor — havaalanı, otel, toplu taşıma, turistik yerler gibi konularda konuşmak istiyor.',
  interview: 'Kullanıcı bir iş görüşmesine hazırlanıyor. Tipik mülakat soruları sor, profesyonel dil kullan.',
  daily: 'Kullanıcı günlük yaşam konularında sohbet etmek istiyor — hava durumu, alışkanlıklar, hobiler, aile vb.',
  shopping: 'Kullanıcı alışveriş yapıyor — mağazada, süpermarkette veya online alışveriş hakkında konuşmak istiyor.',
  health: 'Kullanıcı sağlık konusunda konuşmak istiyor — doktora gitme, ilaç, belirtiler, randevu alma vb.',
  education: 'Kullanıcı eğitim konusunda konuşmak istiyor — okul, üniversite, kurslar, sınavlar vb.'
};

export const LEVEL_DESCRIPTIONS = {
  A1: 'Başlangıç — Çok basit cümleler, temel kelimeler. Yavaş ve net konuş.',
  A2: 'Temel — Basit günlük cümleler, kısa diyaloglar.',
  B1: 'Orta — Günlük konularda akıcı konuşma, orta karmaşıklıkta yapılar.',
  B2: 'Ortanın üstü — Detaylı konuşma, soyut konular, karmaşık cümleler.',
  C1: 'İleri — Akademik ve profesyonel dil, nüanslar, deyimler.',
  C2: 'Ustalaşmış — Ana dil seviyesine yakın, her türlü konu ve kayıt.'
};





// Gemini TTS prebuilt voices
export const GEMINI_VOICES = {
  female: 'Kore',     // Kadın, sakin, çok dilli
  male: 'Puck',       // Erkek, neşeli, çok dilli
  auto: 'Kore'        // Varsayılan
};

// Gemini Audio models
export const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview'; // Specific model for BidiGenerateContent
export const GEMINI_LIVE_API_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

// Default settings
export const DEFAULT_SETTINGS = {
  geminiKey: '',
  geminiVoice: 'auto',
  voiceSpeed: 1.0,
  liveAudioEnabled: true,
  liveFeedbackEnabled: true,
  liveFeedbackLang: 'TR',
  liveMicEnabled: true,
  autoDisconnectTimeout: 60,
  level: 'B1',
  topic: 'free'
};

export function buildGeminiSystemPrompt(level, topic, feedbackEnabled = true, feedbackLang = 'TR') {
  const levelDesc = LEVEL_DESCRIPTIONS[level] || LEVEL_DESCRIPTIONS['B1'];
  const topicCtx = TOPIC_CONTEXTS[topic] || '';

  let feedbackRule = '';
  if (!feedbackEnabled) {
    feedbackRule = `1. İLETİŞİM ŞEKLİ: Kullanıcı ne kadar gramer veya telaffuz hatası yaparsa yapsın, KESİNLİKLE HATALARINI DÜZELTME! GERİ BİLDİRİM VERME! 
2. SADECE ALMANCA: Sadece doğal bir şekilde karşılıklı Almanca sohbete devam et ve konuyu ilerlet. ASLA Türkçe konuşma.`;
  } else {
    if (feedbackLang === 'TR') {
      feedbackRule = `1. İLETİŞİM ŞEKLİ: Kullanıcının cümleleri doğruysa HİÇ TÜRKÇE KULLANMADAN doğrudan Almanca cevap ver.
2. HATA DÜZELTME (ÇOK ÖNEMLİ): Eğer kullanıcının cümlesinde gramer, telaffuz veya kelime hatası varsa, İLK OLARAK KESİNLİKLE TÜRKÇE DİLİNDE (TÜRKÇE KELİMELERLE) konuşarak hatayı açıkla. Örnek: "Burada 'gehen' yerine 'fahre' demelisin."
3. ALMANCAYA GEÇİŞ: Türkçe hata düzeltmesi bittikten sonra, doğrudan Almanca diline geçiş yap ve konuyu ilerletecek yeni bir Almanca soru sor.
DİKKAT: HATA DÜZELTİRKEN ASLA ALMANCA KULLANMA, SOHBET EDERKEN DE ASLA TÜRKÇE KULLANMA! HATA DÜZELTME = TÜRKÇE, SOHBET = ALMANCA.`;
    } else {
      feedbackRule = `1. İLETİŞİM ŞEKLİ: Kullanıcıyla her zaman SADECE ALMANCA konuş.
2. HATA DÜZELTME: Eğer kullanıcının cümlesinde gramer veya kelime hatası varsa, İLK OLARAK ALMANCA DİLİNDE hatasını kibarca düzelt (Örneğin: "Man sagt eigentlich...").
3. SOHBETE DEVAM: Hata düzeltmesinden sonra, yine Almanca olarak sohbete devam et. ASLA Türkçe kullanma!`;
    }
  }

  return `Sen DeutschVoice adlı bir uygulamanın yapay zeka dil eğitmenisin.
Uzmanlığın Almanca öğretmek ve kullanıcıyla Almanca sohbet etmek.
Kullanıcı Türkçe konuşan bir Almanca öğrencisi.
Kullanıcının seviyesi: ${level} (${levelDesc})

${topicCtx ? `KONU BAĞLAMI: ${topicCtx}\n` : ''}
KURALLAR (BUNLARA KESİNLİKLE UYMALISIN):
${feedbackRule}
4. DOĞRU CÜMLELER: Kullanıcının cümlesi DOĞRUYSA asla hata uydurma! Gerçekten net bir dilbilgisi veya kelime hatası yoksa, gereksiz yere düzeltme yapma ve doğrudan Almanca sohbete devam et.
5. YASAKLAR: Asla köşeli parantez (örneğin [FEEDBACK] veya [CHAT]) veya özel işaretler kullanma. Sen sesli bir asistansın, bu işaretleri okumaya çalışmak sistemi bozar. Sadece doğrudan konuş.
6. FORMAT: Konuşmalarını uzun ve tek bir blok halinde yazma! Paragraflara böl. Özellikle Türkçe açıklamalardan sonra Almanca'ya geçerken mutlaka iki satır boşluk bırak.

SON HATIRLATMA: Bu sohbet ne kadar uzarsa uzasın, hata düzeltmelerini daima TÜRKÇE yapmayı, ardından da ALMANCA sohbete dönmeyi ASLA UNUTMA! Sen bir öğretmensin, öğrenciye Türkçe açıklama yapmak senin temel görevin.`;
}
