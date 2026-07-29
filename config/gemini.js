const { GoogleGenAI } = require('@google/genai');

function getGemini() {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required for Gemini operations');
  return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
}

module.exports = { getGemini };
