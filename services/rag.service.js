const { extractPdfText, chunkText } = require('./pdf.service');
const { embedTexts } = require('./embedding.service');
const { upsertChunks, search } = require('./vector.service');
const { generateJson } = require("./llm.service");

async function indexDocument(document) {
  const chunks = chunkText(await extractPdfText(document.fileUrl));
  if (!chunks.length) throw new Error('No readable text found in the PDF');
  await upsertChunks(document.vectorNS, document._id, chunks, await embedTexts(chunks, 'RETRIEVAL_DOCUMENT'));
  return chunks.length;
}

function parseJsonResponse(content) {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error('The AI returned an invalid structured response');
  }
}

async function answerQuestion(document, question) {
  const vector = (await embedTexts([question], 'RETRIEVAL_QUERY'))[0];
  const matches = await search(document.vectorNS, document._id, vector, Number(process.env.RAG_TOP_K || 5));
  if (!matches.length) throw new Error('No relevant document context was found');
  const sources = matches.map((match) => {
    const metadata = match.payload || match.metadata || {};
    return { chunkIndex: metadata.chunkIndex, score: match.score, text: metadata.text };
  }).filter((source) => typeof source.text === 'string' && source.text.length > 0);
  if (!sources.length) throw new Error('No readable document context was found');
  const context = sources.map((source) => '[Chunk ' + source.chunkIndex + ']\n' + source.text).join('\n\n');
  const { content } = await generateJson({
    systemInstruction:
      'You are a legal-document assistant. Use only the supplied context and do not provide legal advice. Return valid JSON: {"answer":"plain-language answer","riskFlags":[{"level":"low|medium|high","clause":"quoted or paraphrased clause","reason":"why it matters","chunkIndex":0}],"insufficientContext":false}. Set insufficientContext true when the context cannot answer the question.',
    prompt:
      'Context:\n' +
      context +
      '\n\nQuestion:\n' +
      question,
  });

  const response = parseJsonResponse(content);
  return {
    answer: response.answer || 'The document context did not provide an answer.',
    riskFlags: Array.isArray(response.riskFlags) ? response.riskFlags : [],
    insufficientContext: Boolean(response.insufficientContext),
    sources,
  };
}

module.exports = { indexDocument, answerQuestion };
