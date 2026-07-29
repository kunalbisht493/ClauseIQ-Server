const Groq = require('groq-sdk');

function getGroq() {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is required when the Gemini fallback is used');
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

module.exports = { getGroq };
