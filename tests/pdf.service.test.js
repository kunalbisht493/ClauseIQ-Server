jest.mock('../services/ocr.service', () => ({
  extractTextWithGemini: jest.fn(),
}));

const { chunkText, extractPdfText } = require('../services/pdf.service');
const { extractTextWithGemini } = require('../services/ocr.service');

describe('chunkText', () => {
  it('creates token-bounded chunks with overlap', () => {
    const text = Array.from({ length: 1_200 }, (_, index) => 'word' + index).join(' ');
    const chunks = chunkText(text, 50, 10);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain('word0');
    expect(chunks[1]).toContain('word');
  });

  it('rejects an overlap equal to or larger than the chunk size', () => {
    expect(() => chunkText('text', 50, 50)).toThrow('RAG_CHUNK_OVERLAP');
  });
});

