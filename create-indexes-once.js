require('dotenv').config();
const { getQdrant } = require('./config/qdrant');

async function main() {
  const client = getQdrant();
  const collection = process.env.QDRANT_COLLECTION || 'legal_document_chunks';

  await client.createPayloadIndex(collection, { field_name: 'vectorNS', field_schema: 'keyword' });
  console.log('Created index on vectorNS');

  await client.createPayloadIndex(collection, { field_name: 'documentId', field_schema: 'keyword' });
  console.log('Created index on documentId');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });