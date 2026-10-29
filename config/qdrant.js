const { QdrantClient } = require('@qdrant/js-client-rest');

// Reuse one client (and its HTTP connections) per URL/key pair.
let cached = { id: null, client: null };

function getQdrant() {
  if (!process.env.QDRANT_URL || !process.env.QDRANT_API_KEY) throw new Error('QDRANT_URL and QDRANT_API_KEY are required for vector operations');
  const id = `${process.env.QDRANT_URL}|${process.env.QDRANT_API_KEY}`;
  if (cached.id !== id) cached = { id, client: new QdrantClient({ url: process.env.QDRANT_URL, apiKey: process.env.QDRANT_API_KEY }) };
  return cached.client;
}

module.exports = { getQdrant };
