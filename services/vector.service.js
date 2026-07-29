const { getQdrant } = require('../config/qdrant');

function pointId(documentId, chunkIndex) {
  const raw = String(documentId) + Number(chunkIndex).toString(16).padStart(8, '0');
  return raw.slice(0, 8) + '-' + raw.slice(8, 12) + '-' + raw.slice(12, 16) + '-' + raw.slice(16, 20) + '-' + raw.slice(20, 32);
}

async function ensureCollection(vectorSize) {
  const client = getQdrant();
  const collection = process.env.QDRANT_COLLECTION || 'legal_document_chunks';
  try {
    await client.getCollection(collection);
  } catch (error) {
    if (error.status !== 404) throw error;
    await client.createCollection(collection, { vectors: { size: vectorSize, distance: 'Cosine' } });
  }
  return { client, collection };
}

async function upsertChunks(vectorNS, documentId, chunks, vectors) {
  const { client, collection } = await ensureCollection(vectors[0].length);
  const records = chunks.map((text, index) => ({
    id: pointId(documentId, index),
    vector: vectors[index],
    payload: { vectorNS, documentId: String(documentId), text, chunkIndex: index },
  }));
  for (let start = 0; start < records.length; start += 100) {
    await client.upsert(collection, { wait: true, points: records.slice(start, start + 100) });
  }
}

async function search(vectorNS, documentId, vector, topK = 5) {
  const { client, collection } = await ensureCollection(vector.length);
  const result = await client.query(collection, {
    query: vector,
    limit: topK,
    with_payload: true,
    filter: { must: [
      { key: 'vectorNS', match: { value: vectorNS } },
      { key: 'documentId', match: { value: String(documentId) } },
    ] },
  });
  return result.points || result || [];
}

module.exports = { upsertChunks, search };
