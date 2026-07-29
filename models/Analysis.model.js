const mongoose = require('mongoose');

const analysisSchema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, unique: true },
  question: { type: String, trim: true },
  answer: String,
  riskScore: { type: Number, min: 0, max: 100, default: 0 },
  riskClauses: [{ clause: String, level: String, score: Number, reason: String }],
  summary: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Analysis', analysisSchema);
