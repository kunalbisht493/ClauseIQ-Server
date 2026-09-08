const fs = require("fs/promises");
const { getEncoding } = require("js-tiktoken");
const { extractTextWithGemini } = require("./ocr.service");

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

  const pdf = await pdfjs.getDocument({
    data: uint8,
    useSystemFonts: true,
  }).promise;

  const pagePromises = Array.from({ length: pdf.numPages }, async (_, i) => {
    const page = await pdf.getPage(i + 1);
    const content = await page.getTextContent();
    return content.items.map((item) => item.str).join(" ");
  });

  const pageTexts = await Promise.all(pagePromises);
  const text = pageTexts.join("\n");

  const trimmedText = text.trim();
  if (trimmedText) {
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

  const encoding = getEncoding("cl100k_base");
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