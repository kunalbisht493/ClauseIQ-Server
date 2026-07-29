const { getGemini } = require('../config/gemini');

async function embedTexts(input) {
  const batchSize = 100;
  const embeddings = [];
  for (let start = 0; start < input.length; start += batchSize) {
    const response = await getGemini().models.embedContent({
      model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
      contents: input.slice(start, start + batchSize),
    });
    embeddings.push(...response.embeddings.map((item) => item.values));
  }
  return embeddings;
}

module.exports = { embedTexts };
