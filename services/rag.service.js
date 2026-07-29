const { extractPdfText, chunkText } = require('./pdf.service');
const { embedTexts } = require('./embedding.service');
const { upsertChunks, search } = require('./vector.service');
const { getOpenAI } = require('../config/openai');

async function indexDocument(document) {
  const chunks = chunkText(await extractPdfText(document.fileUrl));
  if (!chunks.length) throw new Error('No readable text found in the PDF');
  await upsertChunks(document.vectorNS, document._id, chunks, await embedTexts(chunks));
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
  const vector = (await embedTexts([question]))[0];
  const matches = await search(document.vectorNS, document._id, vector, Number(process.env.RAG_TOP_K || 5));
  if (!matches.length) throw new Error('No relevant document context was found');
  const sources = matches.map((match) => ({
    chunkIndex: match.metadata.chunkIndex,
    score: match.score,
    text: match.metadata.text,
  }));
  const context = sources.map((source) => '[Chunk ' + source.chunkIndex + ']\n' + source.text).join('\n\n');
  const completion = await getOpenAI().chat.completions.create({
    model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a legal-document assistant. Use only the supplied context and do not provide legal advice. Return valid JSON: {"answer":"plain-language answer","riskFlags":[{"level":"low|medium|high","clause":"quoted or paraphrased clause","reason":"why it matters","chunkIndex":0}],"insufficientContext":false}. Set insufficientContext true when the context cannot answer the question.' },
      { role: 'user', content: 'Context:\n' + context + '\n\nQuestion: ' + question },
    ],
  });
  const response = parseJsonResponse(completion.choices[0].message.content);
  return {
    answer: response.answer || 'The document context did not provide an answer.',
    riskFlags: Array.isArray(response.riskFlags) ? response.riskFlags : [],
    insufficientContext: Boolean(response.insufficientContext),
    sources,
  };
}

module.exports = { indexDocument, answerQuestion };
