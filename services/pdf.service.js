const fs = require("fs/promises");
const { getEncoding } = require("js-tiktoken");
const { extractTextWithGemini } = require("./ocr.service");

// Building the tokenizer parses a large rank table; do it once, not on every upload.
let encoding = null;
function getTokenizer() {
  if (!encoding) encoding = getEncoding("cl100k_base");
  return encoding;
}

let pdfjsPromise = null;
function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjsPromise;
}

async function extractPdfText(filePath, mimeType = "application/pdf") {
  const [buffer, pdfjs] = await Promise.all([
    fs.readFile(filePath),
    getPdfJs(),
  ]);

  const uint8 = new Uint8Array(buffer);

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    useSystemFonts: true,
  });
  const pdf = await loadingTask.promise;

  let pageTexts;
  try {
    const pagePromises = Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1);
      try {
        const content = await page.getTextContent();
        return content.items.map((item) => item.str).join(" ");
      } finally {
        page.cleanup();
      }
    });
    pageTexts = await Promise.all(pagePromises);
  } finally {
    // Free parser memory promptly (matters on small instances with big PDFs).
    // destroy() lives on the loading task, not on the resolved document proxy.
    await loadingTask.destroy();
  }

  const text = pageTexts.join("\n");
  const trimmedText = text.trim();

  const emptyPages = pageTexts
    .map((t, i) => (t.trim() ? null : i + 1))
    .filter(Boolean);

  if (trimmedText) {
    // Mixed documents (some scanned pages) would otherwise silently lose those pages.
    // Opt-in: set OCR_EMPTY_PAGE_RATIO (e.g. 0.3) to OCR the whole file when at least that
    // fraction of pages has no text layer. Unset = previous behaviour (native text only).
    const ratio = Number(process.env.OCR_EMPTY_PAGE_RATIO);
    if (emptyPages.length) {
      console.warn(`PDF has ${emptyPages.length}/${pageTexts.length} pages without extractable text: ${emptyPages.slice(0, 20).join(", ")}`);
    }
    if (ratio > 0 && emptyPages.length / pageTexts.length >= ratio) {
      try {
        const ocrText = await extractTextWithGemini(filePath, mimeType);
        if (ocrText && ocrText.trim().length > trimmedText.length) {
          return ocrText.trim();
        }
      } catch (ocrError) {
        console.warn("Partial-scan OCR failed, using native text:", ocrError.message);
      }
    }
    return trimmedText;
  }

  // Fallback to OCR if PDF contains only scanned images / no selectable text
  try {
    const ocrText = await extractTextWithGemini(filePath, mimeType);
    if (ocrText && ocrText.trim()) {
      return ocrText.trim();
    }
  } catch (ocrError) {
    console.warn("OCR fallback failed or returned empty text:", ocrError.message);
  }

  return "";
}

function chunkText(
  text,
  size = Number(process.env.RAG_CHUNK_SIZE || 500),
  overlap = Number(process.env.RAG_CHUNK_OVERLAP || 50)
) {
  if (
    !Number.isInteger(size) ||
    size < 1 ||
    !Number.isInteger(overlap) ||
    overlap < 0 ||
    overlap >= size
  ) {
    throw new Error(
      "RAG_CHUNK_SIZE must be positive and RAG_CHUNK_OVERLAP must be smaller than it"
    );
  }

  const encoding = getTokenizer();
  const tokens = encoding.encode(text);

  const chunks = [];

  for (let start = 0; start < tokens.length; start += size - overlap) {
    const chunk = Buffer.from(
      encoding.decode(tokens.slice(start, start + size))
    )
      .toString("utf8")
      .trim();

    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}

module.exports = {
  extractPdfText,
  chunkText,
};