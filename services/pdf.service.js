const fs = require("fs/promises");
const { getEncoding } = require("js-tiktoken");
const { extractTextWithGemini } = require("./ocr.service");

async function extractPdfText(filePath, mimeType = "application/pdf") {
  const buffer = await fs.readFile(filePath);
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const uint8 = new Uint8Array(buffer);

  const pdf = await pdfjs.getDocument({
    data: uint8,
    useSystemFonts: true,
  }).promise;

  let text = "";

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const content = await page.getTextContent();

    text +=
      content.items
        .map((item) => item.str)
        .join(" ") + "\n";
  }

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