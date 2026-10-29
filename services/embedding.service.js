const { getGemini } = require('../config/gemini');

const BATCH_SIZE = Number(process.env.EMBED_BATCH_SIZE || 20);
const MAX_CONCURRENCY = Number(process.env.EMBED_CONCURRENCY || 1);

function isRateLimitError(err) {
  if (!err) return false;
  if (err.status === 429 || err.code === 429 || err.status === 'RESOURCE_EXHAUSTED') return true;
  const msg = err.message || (typeof err === 'string' ? err : '');
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded');
}

function getRetryDelayMs(err, fallbackMs = 45000) {
  const msg = err?.message || (typeof err === 'string' ? err : '');
  const match = msg.match(/retry in ([0-9.]+)s/i) || msg.match(/retryDelay.*?(\d+)s/i);
  if (match) {
    return (Math.ceil(parseFloat(match[1])) + 3) * 1000;
  }
  return fallbackMs;
}

async function embedBatch(batch, outputDimensionality, taskType, retries = 5) {
  try {
    const response = await getGemini().models.embedContent({
      model: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
      contents: batch,
      config: { outputDimensionality, ...(taskType ? { taskType } : {}) },
    });
    if (!Array.isArray(response.embeddings) || response.embeddings.length !== batch.length) {
      throw new Error('Gemini returned an unexpected number of embeddings');
    }
    return response.embeddings.map((item) => item.values);
  } catch (error) {
    if (isRateLimitError(error) && retries > 0) {
      const waitMs = getRetryDelayMs(error, 45000);
      console.warn(`Gemini embedding rate-limited. Pausing ${Math.round(waitMs / 1000)}s for quota replenishment... (Retries left: ${retries})`);
      await new Promise((r) => setTimeout(r, waitMs));
      return embedBatch(batch, outputDimensionality, taskType, retries - 1);
    }
    throw error;
  }
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
