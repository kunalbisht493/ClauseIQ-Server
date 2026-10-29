const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const { answerQuestion, streamAnswer } = require('../services/rag.service');

// Q&A works as soon as the document is indexed; the risk analysis may still be running.
const QA_READY_STATUSES = ['indexed', 'ready'];

async function getAnalysis(req, res) {
  const document = await Document.findOne({ _id: req.params.documentId, userId: req.user.id });
  if (!document) return res.status(404).json({ message: 'Document not found' });
  res.json({ analysis: await Analysis.findOne({ documentId: document._id }) });
}

// Validates the request and loads what both Q&A endpoints need. Sends the error response
// itself and returns null when the request can't proceed.
async function loadQaContext(req, res) {
  // Independent reads, so run them together. The analysis is only used if the document
  // really belongs to this user.
  const [document, analysis] = await Promise.all([
    Document.findOne({ _id: req.params.documentId, userId: req.user.id, status: { $in: QA_READY_STATUSES } }),
    Analysis.findOne({ documentId: req.params.documentId }).select('riskClauses').lean(),
  ]);
  if (!document) {
    res.status(404).json({ message: 'Ready document not found' });
    return null;
  }
  const question = String(req.body.question || '').trim();
  if (!question) {
    res.status(400).json({ message: 'A question is required' });
    return null;
  }
  if (question.length > 4000) {
    res.status(400).json({ message: 'Question must be 4,000 characters or fewer' });
    return null;
  }
  return { document, question, knownRisks: analysis?.riskClauses || [] };
}

function buildQaEntry(question, result) {
  return {
    question,
    answer: result.answer,
    sources: result.sources || [],
    riskFlags: result.riskFlags || [],
    insufficientContext: Boolean(result.insufficientContext),
    createdAt: new Date(),
  };
}

// Persisting history is bookkeeping, not part of the answer, so it happens AFTER the
// response has been sent and never blocks the user.
function persistQaEntry(documentId, qaEntry) {
  return Analysis.findOneAndUpdate(
    { documentId },
    { $set: { question: qaEntry.question, answer: qaEntry.answer }, $push: { qaHistory: qaEntry } },
    { upsert: true, setDefaultsOnInsert: true },
  ).catch((error) => console.error('Failed to persist Q&A history for', documentId, error.message));
}

async function askQuestion(req, res) {
  const ctx = await loadQaContext(req, res);
  if (!ctx) return;

  const result = await answerQuestion(ctx.document, ctx.question, ctx.knownRisks);
  const qaEntry = buildQaEntry(ctx.question, result);

  // Return only the new entry. (Returning the whole analysis re-sent every previous
  // answer and its source text on each question, so responses grew with usage.)
  res.json({ ...result, qaEntry });
  persistQaEntry(ctx.document._id, qaEntry);
}

// Server-Sent Events over POST:
//   event: sources  data: [...]            (citations, right after retrieval)
//   event: token    data: {"text": "..."}  (answer text as it is generated)
//   event: done     data: {"qaEntry": {...}, ...}
//   event: error    data: {"message": "..."}
async function askQuestionStream(req, res) {
  const ctx = await loadQaContext(req, res);
  if (!ctx) return;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // stop reverse proxies from buffering the stream
  res.flushHeaders();

  const send = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Abort the LLM call if the browser goes away. (Use res 'close': on modern Node the
  // request's own 'close' fires as soon as the body is read, not when the client leaves.)
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });

  try {
    for await (const event of streamAnswer(ctx.document, ctx.question, ctx.knownRisks, { signal: abort.signal })) {
      if (event.type === 'sources') send('sources', event.sources);
      else if (event.type === 'token') send('token', { text: event.text });
      else if (event.type === 'done') {
        const qaEntry = buildQaEntry(ctx.question, event.result);
        send('done', { ...event.result, qaEntry });
        persistQaEntry(ctx.document._id, qaEntry);
      }
    }
  } catch (error) {
    if (!abort.signal.aborted) {
      console.error('Streaming Q&A failed:', error);
      send('error', { message: error.message || 'Failed to generate an answer.' });
    }
  } finally {
    res.end();
  }
}

module.exports = { getAnalysis, askQuestion, askQuestionStream };
