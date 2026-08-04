const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const { indexDocument } = require('../services/rag.service');
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
  const riskClauses = Array.isArray(result.risks) ? result.risks : [];

  const riskScore = Math.min(
    100,
    riskClauses.reduce((highest, risk) => Math.max(highest, Number(risk.score) || 0), 0)
  );

  return {
    summary: result.summary || '',
    riskScore,
    riskLevel: levelFromScore(riskScore),
    riskClauses,
  };
}

async function uploadDocument(req, res) {
  if (!req.file) return res.status(400).json({ message: 'A PDF file is required' });
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
    status: 'processing',
  });
  try {
    const chunkCount = await indexDocument(document);
    document.status = 'ready';
    document.chunkCount = chunkCount;
    await document.save();
    const result = await assessRisks(await extractPdfText(document.fileUrl));
    await Analysis.create({ documentId: document._id, ...normalizeAnalysis(result) });
  } catch (error) {
    document.status = 'failed';
    document.error = error.message;
    await document.save();
  }
  res.status(201).json({ document });
}

async function listDocuments(req, res) {
  const documents = await Document.find({ userId: req.user.id }).sort({ uploadedAt: -1 });
  res.json({ documents });
}

async function getDocument(req, res) {
  const document = await Document.findOne({ _id: req.params.documentId, userId: req.user.id });
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

  res.json({ message: 'Document deleted successfully' });
}

module.exports = { uploadDocument, listDocuments, getDocument, deleteDocument };
