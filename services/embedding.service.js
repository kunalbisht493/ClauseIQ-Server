const { getGemini } = require('../config/gemini');

const BATCH_SIZE = 100;
const MAX_CONCURRENCY = Number(process.env.EMBED_CONCURRENCY || 4);

async function embedBatch(batch, outputDimensionality, taskType) {
  const response = await getGemini().models.embedContent({
    model: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    contents: batch,
    config: { outputDimensionality, ...(taskType ? { taskType } : {}) },
  });
  if (!Array.isArray(response.embeddings) || response.embeddings.length !== batch.length) {
    throw new Error('Gemini returned an unexpected number of embeddings');
  }
  return response.embeddings.map((item) => item.values);
}

async function embedTexts(input, taskType) {
  if (!Array.isArray(input) || input.length === 0) return [];
  const outputDimensionality = Number(process.env.GEMINI_EMBEDDING_DIMENSIONS || 768);
  if (!Number.isInteger(outputDimensionality) || outputDimensionality < 128 || outputDimensionality > 3072) {
    throw new Error('GEMINI_EMBEDDING_DIMENSIONS must be an integer between 128 and 3072');
  }

  const batches = [];
  for (let start = 0; start < input.length; start += BATCH_SIZE) {
    batches.push(input.slice(start, start + BATCH_SIZE));
  }

  // Run batches concurrently (bounded) instead of one-after-another. Order is preserved.
  const results = new Array(batches.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= batches.length) return;
      results[index] = await embedBatch(batches[index], outputDimensionality, taskType);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, batches.length) }, worker));

  return results.flat();
}

module.exports = { embedTexts };
