const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const { answerQuestion } = require('../services/rag.service');

async function getAnalysis(req, res) {
  const document = await Document.findOne({ _id: req.params.documentId, userId: req.user.id });
  if (!document) return res.status(404).json({ message: 'Document not found' });
  res.json({ analysis: await Analysis.findOne({ documentId: document._id }) });
}

async function askQuestion(req, res) {
  const document = await Document.findOne({ _id: req.params.documentId, userId: req.user.id, status: 'ready' });
  if (!document) return res.status(404).json({ message: 'Ready document not found' });
  const question = String(req.body.question || '').trim();
  if (!question) return res.status(400).json({ message: 'A question is required' });
  if (question.length > 4000) return res.status(400).json({ message: 'Question must be 4,000 characters or fewer' });
  const result = await answerQuestion(document, question);
  const analysis = await Analysis.findOneAndUpdate(
    { documentId: document._id },
    { question, answer: result.answer },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  res.json({ ...result, analysis });
}

module.exports = { getAnalysis, askQuestion };