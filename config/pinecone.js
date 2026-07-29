const { Pinecone } = require('@pinecone-database/pinecone');

function getPineconeIndex() {
  if (!process.env.PINECONE_API_KEY || !process.env.PINECONE_INDEX) {
    throw new Error('PINECONE_API_KEY and PINECONE_INDEX are required for vector operations');
  }
  return new Pinecone({ apiKey: process.env.PINECONE_API_KEY }).index(process.env.PINECONE_INDEX);
}

module.exports = { getPineconeIndex };
