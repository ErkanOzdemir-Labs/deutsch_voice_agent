const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.APPDATA || process.env.HOME || '', '.gemini', 'config', 'config.json');

async function test() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY || 'fake'}`;
  console.log("URL:", url);
}
test();
