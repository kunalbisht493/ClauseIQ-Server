const http = require('http');
const express = require('express');
const request = require('supertest');

jest.mock('../middleware/auth.middleware', () => ({ requireAuth: (req, _res, next) => { req.user = { id: 'user1' }; next(); } }));
jest.mock('../models/Document.model', () => ({ findOne: jest.fn() }));
jest.mock('../models/Analysis.model', () => ({ findOne: jest.fn(), findOneAndUpdate: jest.fn() }));
jest.mock('../services/rag.service', () => ({ answerQuestion: jest.fn(), streamAnswer: jest.fn() }));

const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const { answerQuestion, streamAnswer } = require('../services/rag.service');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analyses', require('../routes/analysis.routes'));
  app.use((err, _req, res, _next) => res.status(500).json({ message: err.message }));
  return app;
}

const doc = { _id: 'doc1', vectorNS: 'document-doc1', status: 'indexed' };
const sources = [{ chunkIndex: 1, score: 0.9, text: 'Term is 12 months.' }];

function parseSse(text) {
  return text.split('\n\n').filter(Boolean).map((block) => {
    const event = /^event: (.*)$/m.exec(block)[1];
    const data = JSON.parse(/^data: (.*)$/m.exec(block)[1]);
    return { event, data };
  });
}

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  Document.findOne.mockResolvedValue(doc);
  Analysis.findOne.mockReturnValue({ select: () => ({ lean: () => Promise.resolve({ riskClauses: [{ clause: '1', score: 80 }] }) }) });
  Analysis.findOneAndUpdate.mockResolvedValue({});
});
afterEach(() => console.error.mockRestore());

describe('POST /:documentId/questions', () => {
  it('works while the document is only "indexed" (risk analysis still running)', async () => {
    answerQuestion.mockResolvedValue({ answer: 'Twelve months.', riskFlags: [], insufficientContext: false, sources });

    const res = await request(buildApp()).post('/api/analyses/doc1/questions').send({ question: 'Term?' });

    expect(res.status).toBe(200);
    expect(Document.findOne.mock.calls[0][0].status.$in).toEqual(['indexed', 'ready']);
    expect(answerQuestion).toHaveBeenCalledWith(doc, 'Term?', [{ clause: '1', score: 80 }]);
  });

  it('returns only the new entry, not the whole analysis history', async () => {
    answerQuestion.mockResolvedValue({ answer: 'A', riskFlags: [], insufficientContext: false, sources });

    const res = await request(buildApp()).post('/api/analyses/doc1/questions').send({ question: 'Q' });

    expect(res.body.analysis).toBeUndefined();
    expect(res.body.qaEntry).toMatchObject({ question: 'Q', answer: 'A' });
    expect(res.body.qaEntry.sources).toEqual(sources);
  });

  it('persists the history after responding', async () => {
    answerQuestion.mockResolvedValue({ answer: 'A', riskFlags: [], insufficientContext: false, sources });
    await request(buildApp()).post('/api/analyses/doc1/questions').send({ question: 'Q' });
    await new Promise((r) => setImmediate(r));

    const [filter, update, options] = Analysis.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ documentId: 'doc1' });
    expect(update.$push.qaHistory).toMatchObject({ question: 'Q', answer: 'A' });
    expect(options.upsert).toBe(true);
  });

  it('still answers if persisting the history fails', async () => {
    answerQuestion.mockResolvedValue({ answer: 'A', riskFlags: [], insufficientContext: false, sources });
    Analysis.findOneAndUpdate.mockRejectedValue(new Error('mongo down'));
    const res = await request(buildApp()).post('/api/analyses/doc1/questions').send({ question: 'Q' });
    expect(res.status).toBe(200);
  });

  it('validates the question and the document', async () => {
    expect((await request(buildApp()).post('/api/analyses/doc1/questions').send({ question: '  ' })).status).toBe(400);
    expect((await request(buildApp()).post('/api/analyses/doc1/questions').send({ question: 'x'.repeat(4001) })).status).toBe(400);
    Document.findOne.mockResolvedValue(null);
    expect((await request(buildApp()).post('/api/analyses/doc1/questions').send({ question: 'Q' })).status).toBe(404);
  });
});

describe('POST /:documentId/questions/stream', () => {
  it('streams sources, tokens, then a final entry over SSE', async () => {
    streamAnswer.mockImplementation(async function* () {
      yield { type: 'sources', sources };
      yield { type: 'token', text: 'Twelve ' };
      yield { type: 'token', text: 'months.' };
      yield { type: 'done', result: { answer: 'Twelve months.', riskFlags: [], insufficientContext: false, sources } };
    });

    const res = await request(buildApp()).post('/api/analyses/doc1/questions/stream').send({ question: 'Term?' }).buffer(true).parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (data += c));
      r.on('end', () => cb(null, data));
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch('text/event-stream');
    expect(res.headers['cache-control']).toMatch('no-cache');
    expect(res.headers['x-accel-buffering']).toBe('no');

    const events = parseSse(res.body);
    expect(events.map((e) => e.event)).toEqual(['sources', 'token', 'token', 'done']);
    expect(events[3].data.qaEntry).toMatchObject({ question: 'Term?', answer: 'Twelve months.' });

    await new Promise((r) => setImmediate(r));
    expect(Analysis.findOneAndUpdate.mock.calls[0][1].$push.qaHistory.answer).toBe('Twelve months.');
  });

  it('reports a failure as an SSE error event and closes the stream', async () => {
    streamAnswer.mockImplementation(async function* () {
      yield { type: 'sources', sources };
      throw new Error('LLM exploded');
    });

    const res = await request(buildApp()).post('/api/analyses/doc1/questions/stream').send({ question: 'Q' }).buffer(true).parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c) => (data += c));
      r.on('end', () => cb(null, data));
    });

    const events = parseSse(res.body);
    expect(events[events.length - 1]).toEqual({ event: 'error', data: { message: 'LLM exploded' } });
    expect(Analysis.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('returns normal JSON errors (not a stream) for invalid requests', async () => {
    const res = await request(buildApp()).post('/api/analyses/doc1/questions/stream').send({ question: '' });
    expect(res.status).toBe(400);
    expect(res.headers['content-type']).toMatch('json');
  });

  it('aborts the LLM call when the browser disconnects mid-stream', async () => {
    let capturedSignal;
    let abortedAt;
    streamAnswer.mockImplementation(async function* (_d, _q, _r, { signal }) {
      capturedSignal = signal;
      yield { type: 'token', text: 'first' };
      await new Promise((resolve) => signal.addEventListener('abort', () => { abortedAt = Date.now(); resolve(); }));
    });

    const server = http.createServer(buildApp()).listen(0);
    const { port } = server.address();
    await new Promise((resolve, reject) => {
      const body = JSON.stringify({ question: 'Q' });
      const req = http.request({ port, method: 'POST', path: '/api/analyses/doc1/questions/stream', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        res.once('data', () => { clearTimeout(guard); req.destroy(); resolve(); }); // got the first token, then walk away
      });
      req.on('error', () => {});
      const guard = setTimeout(() => reject(new Error('no data received')), 3000);
      req.write(body);
      req.end();
    });
    await new Promise((r) => setTimeout(r, 200));
    server.close();

    expect(capturedSignal.aborted).toBe(true);
    expect(abortedAt).toBeDefined();
    expect(Analysis.findOneAndUpdate).not.toHaveBeenCalled(); // no answer was completed, nothing to save
  });
});
