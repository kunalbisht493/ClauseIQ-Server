const { GoogleGenAI } = require('@google/genai');

// Reuse one client per API key instead of constructing a new one on every call.
let cached = { key: null, client: null };

function getGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is required for Gemini operations');
  if (cached.key !== key) cached = { key, client: new GoogleGenAI({ apiKey: key }) };
  return cached.client;
}

module.exports = { getGemini };
