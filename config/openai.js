const OpenAI = require('openai');

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for AI operations');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

module.exports = { getOpenAI };
