const fs = require('fs/promises');
const { createReadStream } = require('fs');
const crypto = require('crypto');
const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const { indexDocument, indexText } = require('../services/rag.service');
const { extractPdfText } = require('../services/pdf.service');
const { assessRisks } = require('../services/risk.service');
const { deleteChunks } = require('../services/vector.service');
const mongoose = require('mongoose');

function levelFromScore(score) {
  if (score <= 20) return 'Very Low';
  if (score <= 40) return 'Low';
  if (score <= 60) return 'Medium';
  if (score <= 80) return 'High';
  return 'Critical';
}

function normalizeAnalysis(result) {
  let riskClauses = Array.isArray(result.risks) ? result.risks : [];
  const maxRaw = Math.max(...riskClauses.map((r) => Number(r.score) || 0), 0);
  if (maxRaw > 0 && maxRaw <= 10) {
    riskClauses = riskClauses.map((r) => ({
      ...r,
      score: Math.min(100, Math.round((Number(r.score) || 0) * 10)),
    }));
  }

  const scores = riskClauses.map((risk) => Number(risk.score) || 0);
  const maxScore = scores.length ? Math.max(...scores) : 0;
  const avgScore = scores.length ? scores.reduce((sum, s) => sum + s, 0) / scores.length : 0;
  const computedScore = scores.length ? Math.min(100, Math.round(0.5 * maxScore + 0.5 * avgScore)) : 0;

  const aiScore = Number(result.overallRiskScore);
  let riskScore;
  if (Number.isFinite(aiScore) && aiScore > 0 && aiScore <= 100) {
    riskScore = computedScore > 0 ? Math.round(0.6 * computedScore + 0.4 * aiScore) : aiScore;
  } else if (computedScore > 0) {
    riskScore = computedScore;
  } else {
    riskScore = 15;
  }

  return {
    summary: result.summary || '',
    riskScore,
    riskLevel: levelFromScore(riskScore),
    riskClauses,
  };
}

// A job that hasn't progressed for this long is considered dead (e.g. the server restarted
// mid-processing), so the UI doesn't spin forever.
const STALE_PROCESSING_MS = Number(process.env.STALE_PROCESSING_MS || 10 * 60 * 1000);
const IN_FLIGHT = ['processing', 'indexed'];

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function markStale(document) {
  if (
    document &&
    IN_FLIGHT.includes(document.status) &&
    Date.now() - new Date(document.updatedAt).getTime() > STALE_PROCESSING_MS
  ) {
    document.status = 'failed';
    document.error = 'Processing was interrupted. Please upload the document again.';
    await document.save();
  }
  return document;
}

// Runs in the background after the HTTP response has been sent.
//   processing -> indexed (Q&A usable) -> ready (risk analysis stored)
async function processDocument(document) {
  try {
    const text = await extractPdfText(document.fileUrl, document.mimeType || 'application/pdf');

    // Start the long LLM risk call immediately; index vectors while it runs.
    const riskPromise = assessRisks(text);
    riskPromise.catch(() => {}); // failure is handled below; avoids an unhandled rejection meanwhile

    const chunkCount = await indexText(document, text);
    document.chunkCount = chunkCount;
    document.status = 'indexed'; // the user can already ask questions
    await document.save();

    const result = await riskPromise;

    // The user may have deleted the document while we were working.
    if (!(await Document.exists({ _id: document._id }))) {
      await deleteChunks(document.vectorNS, document._id).catch(() => {});
      return;
    }

    // Upsert (not create): the user may have asked questions already, which creates the Analysis doc.
    await Analysis.findOneAndUpdate(
      { documentId: document._id },
      { $set: normalizeAnalysis(result) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    document.status = 'ready';
    await document.save();
  } catch (error) {
    console.error('Document processing failed for', document._id, error);
    try {
      document.status = 'failed';
      document.error = error.message;
      await document.save();
    } catch (saveError) {
      console.error('Could not record failure for document', document._id, saveError.message);
    }
  }
}

async function uploadDocument(req, res) {
  if (!req.file) return res.status(400).json({ message: 'A PDF file is required' });

  // Same user + same bytes => reuse the existing result instead of paying for the pipeline again.
  // This also makes client retries of a slow upload harmless.
  const fileHash = await hashFile(req.file.path);
  const existing = await Document.findOne({
    userId: req.user.id,
    fileHash,
    status: { $in: ['processing', 'indexed', 'ready'] },
  });
  if (existing) {
    await fs.unlink(req.file.path).catch(() => {});
    return res.status(200).json({ document: existing, duplicate: true });
  }

  const documentId = new mongoose.Types.ObjectId();
  const document = await Document.create({
    _id: documentId,
    userId: req.user.id,
    filename: req.file.originalname,
    fileUrl: req.file.path,
    docType: 'pdf',
    vectorNS: 'document-' + documentId,
    mimeType: req.file.mimetype,
    size: req.file.size,
    fileHash,
    status: 'processing',
  });

  // Respond immediately; the client polls GET /documents/:id until status is indexed/ready.
  res.status(202).json({ document });
  setImmediate(() => processDocument(document));
}

/** Mark documents left in-flight by a previous process as failed. Call once at startup. */
async function failInterruptedDocuments() {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MS);
  const result = await Document.updateMany(
    { status: { $in: IN_FLIGHT }, updatedAt: { $lt: cutoff } },
    { $set: { status: 'failed', error: 'Processing was interrupted. Please upload the document again.' } },
  );
  return result.modifiedCount || 0;
}

async function listDocuments(req, res) {
  const documents = await Document.find({ userId: req.user.id }).sort({ uploadedAt: -1 });
  res.json({ documents });
}

async function getDocument(req, res) {
  const document = await markStale(await Document.findOne({ _id: req.params.documentId, userId: req.user.id }));
  if (!document) return res.status(404).json({ message: 'Document not found' });
  const analysis = await Analysis.findOne({ documentId: document._id });
  res.json({ document, analysis });
}

async function deleteDocument(req, res) {
  const document = await Document.findOneAndDelete({ _id: req.params.documentId, userId: req.user.id });
  if (!document) return res.status(404).json({ message: 'Document not found' });

  await Analysis.deleteMany({ documentId: document._id });

  try {
    await deleteChunks(document.vectorNS, document._id);
  } catch (error) {
    console.error('Failed to delete vector chunks for document', document._id, error);
  }

  if (document.fileUrl) {
    try {
      await fs.unlink(document.fileUrl);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Failed to delete file for document', document._id, error);
      }
    }
  }

  res.json({ message: 'Document deleted successfully' });
}

module.exports = { uploadDocument, listDocuments, getDocument, deleteDocument, processDocument, failInterruptedDocuments };
