const mongoose = require('mongoose');

const analysisSchema = new mongoose.Schema({
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true, unique: true },
  question: { type: String, trim: true },
  answer: String,
  riskScore: { type: Number, min: 0, max: 100, default: 0 },
  riskLevel: { type: String, enum: ['Very Low', 'Low', 'Medium', 'High', 'Critical', ''], default: '' },
  riskClauses: [{ clause: String, level: String, score: Number, reason: String, recommendation: String }],
  summary: { type: String, default: '' },
  qaHistory: [
    {
      question: { type: String, trim: true },
      answer: String,
      sources: [
        {
          chunkIndex: Number,
          score: Number,
          text: String,
        },
      ],
      riskFlags: [
        {
          clause: String,
          level: String,
          score: Number,
          reason: String,
          chunkIndex: Number,
        },
      ],
      insufficientContext: { type: Boolean, default: false },
      createdAt: { type: Date, default: Date.now },
    },
  ],
}, { timestamps: true });

module.exports = mongoose.model('Analysis', analysisSchema);