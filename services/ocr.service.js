const { createPartFromUri, createUserContent } = require('@google/genai');
const { getGemini } = require('../config/gemini');

async function extractTextWithGemini(filePath, mimeType) {
  const gemini = getGemini();
  const file = await gemini.files.upload({ file: filePath, config: { mimeType } });
  const response = await gemini.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    contents: [createUserContent([
      createPartFromUri(file.uri, file.mimeType),
      'Transcribe all readable text from this document in reading order. Return only extracted text.',
    ])],
  });
  if (!response.text) throw new Error('Gemini OCR returned no text');
  return response.text.trim();
}

module.exports = { extractTextWithGemini };
