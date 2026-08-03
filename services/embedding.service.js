const { getGemini } = require('../config/gemini');

async function embedTexts(input, taskType) {
  if (!Array.isArray(input) || input.length === 0) return [];
  const outputDimensionality = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);
  if (!Number.isInteger(outputDimensionality) || outputDimensionality < 128 || outputDimensionality > 3072) {
    throw new Error('GEMINI_EMBEDDING_DIMENSIONS must be an integer between 128 and 3072');
  }
  const batchSize = 100;
  const embeddings = [];
  for (let start = 0; start < input.length; start += batchSize) {
    const response = await getGemini().models.embedContent({
      model: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
      contents: input.slice(start, start + batchSize),
      config: { outputDimensionality, ...(taskType ? { taskType } : {}) },
    });
    if (!Array.isArray(response.embeddings) || response.embeddings.length !== input.slice(start, start + batchSize).length) {
      throw new Error('Gemini returned an unexpected number of embeddings');
    }
    embeddings.push(...response.embeddings.map((item) => item.values));
  }
  return embeddings;
}

module.exports = { embedTexts };
