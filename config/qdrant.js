const { QdrantClient } = require('@qdrant/js-client-rest');

function getQdrant() {
  if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY) throw new Error('QDRANT_URL and QDRANT_API_KEY are required for vector operations');
  return new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY });
}

module.exports = { getQdrant };
