const apiKey = process.env.GEMINI_API_KEY || 'YOUR_KEY_HERE'; // I will just fetch without key? No, need a key.
async function list() {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  const data = await res.json();
  console.log(JSON.stringify(data.models.map(m => m.name), null, 2));
}
list();
