const fs = require('fs/promises');
const pdf = require('pdf-parse');
const { getEncoding } = require('js-tiktoken');

async function extractPdfText(filePath) {
  const buffer = await fs.readFile(filePath);
  const { text } = await pdf(buffer);
  return text.trim();
}

function chunkText(text, size = Number(process.env.RAG_CHUNK_SIZE || 500), overlap = Number(process.env.RAG_CHUNK_OVERLAP || 50)) {
  if (!Number.isInteger(size) || size < 1 || !Number.isInteger(overlap) || overlap < 0 || overlap >= size) {
    throw new Error('RAG_CHUNK_SIZE must be positive and RAG_CHUNK_OVERLAP must be smaller than it');
  }
  const encoding = getEncoding('cl100k_base');
  const tokens = encoding.encode(text);
  const chunks = [];
  for (let start = 0; start < tokens.length; start += size - overlap) {
    const chunk = Buffer.from(encoding.decode(tokens.slice(start, start + size))).toString('utf8').trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

module.exports = { extractPdfText, chunkText };
