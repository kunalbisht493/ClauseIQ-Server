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


describe('extractPdfText (real pdfjs)', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');

  // Minimal valid one-page PDF containing a text string. pdfjs rebuilds the xref if needed.
  function tinyPdf(text) {
    const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let out = '%PDF-1.4\n';
    const offsets = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((o) => { out += `${String(o).padStart(10, '0')} 00000 n \n`; });
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return out;
  }

  it('extracts text and releases the parser without throwing (guards the destroy() API)', () => {
    // pdfjs is loaded via dynamic ESM import(), which Jest can't run without experimental flags,
    // so exercise the real module in a plain Node process.
    const { execFileSync } = require('child_process');
    const file = path.join(os.tmpdir(), `clauseiq-real-${Date.now()}.pdf`);
    fs.writeFileSync(file, tinyPdf('Term is twelve months'));
    try {
      const out = execFileSync(
        process.execPath,
        ['-e', `require('./services/pdf.service').extractPdfText(${JSON.stringify(file)}).then((t) => console.log('TEXT:' + t))`],
        { cwd: path.join(__dirname, '..'), encoding: 'utf8' }
      );
      expect(out).toContain('TEXT:Term is twelve months');
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
