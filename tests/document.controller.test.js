const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../models/Document.model', () => ({ create: jest.fn(), findOne: jest.fn(), exists: jest.fn(), find: jest.fn(), findOneAndDelete: jest.fn(), updateMany: jest.fn() }));
jest.mock('../models/Analysis.model', () => ({ findOneAndUpdate: jest.fn(), findOne: jest.fn(), deleteMany: jest.fn(), create: jest.fn() }));
jest.mock('../services/rag.service', () => ({ indexText: jest.fn(), indexDocument: jest.fn() }));
jest.mock('../services/pdf.service', () => ({ extractPdfText: jest.fn() }));
jest.mock('../services/risk.service', () => ({ assessRisks: jest.fn() }));
jest.mock('../services/vector.service', () => ({ deleteChunks: jest.fn() }));

const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const { indexText } = require('../services/rag.service');
const { extractPdfText } = require('../services/pdf.service');
const { assessRisks } = require('../services/risk.service');
const { deleteChunks } = require('../services/vector.service');
const { uploadDocument, processDocument, getDocument, failInterruptedDocuments } = require('../controllers/document.controller');

function fakeDoc(extra = {}) {
  return { _id: 'doc1', vectorNS: 'document-doc1', fileUrl: '/tmp/x.pdf', mimeType: 'application/pdf', status: 'processing', save: jest.fn().mockResolvedValue(), ...extra };
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const riskResult = { summary: 's', overallRiskScore: 40, risks: [{ clause: '1', level: 'medium', score: 50, reason: 'r' }] };
const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  Document.exists.mockResolvedValue(true);
  Analysis.findOneAndUpdate.mockResolvedValue({});
  deleteChunks.mockResolvedValue();
});
afterEach(() => console.error.mockRestore());

describe('processDocument', () => {
  it('becomes "indexed" (Q&A usable) while the slow risk analysis is still running, then "ready"', async () => {
    const risk = deferred();
    extractPdfText.mockResolvedValue('contract text');
    assessRisks.mockReturnValue(risk.promise);
    indexText.mockResolvedValue(12);
    const doc = fakeDoc();

    const job = processDocument(doc);
    await tick();
    await tick();

    expect(doc.status).toBe('indexed');
    expect(doc.chunkCount).toBe(12);
    expect(Analysis.findOneAndUpdate).not.toHaveBeenCalled();

    risk.resolve(riskResult);
    await job;

    expect(doc.status).toBe('ready');
    const [filter, update, options] = Analysis.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ documentId: 'doc1' });
    expect(update.$set.riskClauses).toHaveLength(1);
    expect(options.upsert).toBe(true);
    // upsert (not create) so Q&A history created in the "indexed" window is preserved
    expect(Analysis.create).not.toHaveBeenCalled();
  });

  it('starts the risk call before indexing finishes (they overlap)', async () => {
    const indexing = deferred();
    extractPdfText.mockResolvedValue('contract text');
    assessRisks.mockResolvedValue(riskResult);
    indexText.mockReturnValue(indexing.promise);

    const job = processDocument(fakeDoc());
    await tick();
    expect(assessRisks).toHaveBeenCalledTimes(1);
    indexing.resolve(3);
    await job;
  });

  it('marks the document failed when indexing fails, without an unhandled rejection from the risk call', async () => {
    extractPdfText.mockResolvedValue('text');
    assessRisks.mockRejectedValue(new Error('risk boom'));
    indexText.mockRejectedValue(new Error('index boom'));
    const doc = fakeDoc();

    await processDocument(doc);

    expect(doc.status).toBe('failed');
    expect(doc.error).toBe('index boom');
  });

  it('marks the document failed when the risk analysis fails', async () => {
    extractPdfText.mockResolvedValue('text');
    assessRisks.mockRejectedValue(new Error('invalid risk-analysis response'));
    indexText.mockResolvedValue(2);
    const doc = fakeDoc();

    await processDocument(doc);

    expect(doc.status).toBe('failed');
    expect(doc.error).toMatch('invalid risk-analysis');
  });

  it('cleans up and writes nothing if the user deleted the document mid-processing', async () => {
    extractPdfText.mockResolvedValue('text');
    assessRisks.mockResolvedValue(riskResult);
    indexText.mockResolvedValue(2);
    Document.exists.mockResolvedValue(false);

    await processDocument(fakeDoc());

    expect(deleteChunks).toHaveBeenCalledWith('document-doc1', 'doc1');
    expect(Analysis.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('uploadDocument', () => {
  let file;
  beforeEach(() => {
    file = path.join(os.tmpdir(), `clauseiq-test-${Date.now()}-${Math.random()}.pdf`);
    fs.writeFileSync(file, '%PDF-1.4 test contract bytes');
  });
  afterEach(() => fs.rmSync(file, { force: true }));

  function reqRes() {
    const req = { user: { id: 'user1' }, file: { path: file, originalname: 'c.pdf', mimetype: 'application/pdf', size: 28 } };
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    return { req, res };
  }

  it('responds 202 immediately and does not wait for processing', async () => {
    Document.findOne.mockResolvedValue(null);
    Document.create.mockImplementation(async (d) => fakeDoc(d));
    extractPdfText.mockReturnValue(new Promise(() => {})); // processing never finishes
    const { req, res } = reqRes();

    await uploadDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    const created = Document.create.mock.calls[0][0];
    expect(created.status).toBe('processing');
    expect(created.fileHash).toMatch(/^[0-9a-f]{64}$/);

    // ...and the pipeline is kicked off in the background after the response
    await tick();
    expect(extractPdfText).toHaveBeenCalledTimes(1);
  });

  it('returns the existing document for a duplicate upload and deletes the new file', async () => {
    const existing = fakeDoc({ status: 'ready' });
    Document.findOne.mockResolvedValue(existing);
    const { req, res } = reqRes();

    await uploadDocument(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ document: existing, duplicate: true });
    expect(Document.create).not.toHaveBeenCalled();
    expect(extractPdfText).not.toHaveBeenCalled();
    expect(fs.existsSync(file)).toBe(false);
    // only in-flight / finished documents count as duplicates; failed ones can be retried
    expect(Document.findOne.mock.calls[0][0].status.$in).toEqual(['processing', 'indexed', 'ready']);
  });

  it('rejects a request without a file', async () => {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
    await uploadDocument({ user: { id: 'u' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('stale in-flight documents', () => {
  it('getDocument marks a long-stalled "processing" document as failed', async () => {
    const stale = fakeDoc({ status: 'processing', updatedAt: new Date(Date.now() - 60 * 60 * 1000) });
    Document.findOne.mockResolvedValue(stale);
    Analysis.findOne.mockResolvedValue(null);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await getDocument({ params: { documentId: 'doc1' }, user: { id: 'u' } }, res);

    expect(stale.status).toBe('failed');
    expect(stale.save).toHaveBeenCalled();
  });

  it('leaves a fresh "processing" document alone', async () => {
    const fresh = fakeDoc({ status: 'processing', updatedAt: new Date() });
    Document.findOne.mockResolvedValue(fresh);
    Analysis.findOne.mockResolvedValue(null);
    await getDocument({ params: { documentId: 'doc1' }, user: { id: 'u' } }, { status: jest.fn().mockReturnThis(), json: jest.fn() });
    expect(fresh.status).toBe('processing');
  });

  it('startup sweep fails only old in-flight documents', async () => {
    Document.updateMany.mockResolvedValue({ modifiedCount: 2 });
    expect(await failInterruptedDocuments()).toBe(2);
    const [filter, update] = Document.updateMany.mock.calls[0];
    expect(filter.status.$in).toEqual(['processing', 'indexed']);
    expect(filter.updatedAt.$lt).toBeInstanceOf(Date);
    expect(update.$set.status).toBe('failed');
  });
});
