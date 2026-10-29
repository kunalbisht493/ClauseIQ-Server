const Groq = require('groq-sdk');

// Reuse one client per API key instead of constructing a new one on every call.
let cached = { key: null, client: null };

function getGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is required when the Gemini fallback is used');
  if (cached.key !== key) cached = { key, client: new Groq({ apiKey: key }) };
  return cached.client;
}

module.exports = { getGroq };
