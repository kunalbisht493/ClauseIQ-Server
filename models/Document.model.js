const mongoose = require('mongoose');

const documentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  filename: { type: String, required: true },
  fileUrl: { type: String, required: true },
  docType: { type: String, required: true },
  vectorNS: { type: String, required: true, unique: true, immutable: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  fileHash: { type: String },
  status: { type: String, enum: ['uploaded', 'processing', 'indexed', 'ready', 'failed'], default: 'uploaded' },
  chunkCount: { type: Number, default: 0 },
  rateLimitWaitSec: { type: Number, default: 0 },
  error: String,
  uploadedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Fast duplicate-upload lookup per user.
documentSchema.index({ userId: 1, fileHash: 1 });

module.exports = mongoose.model('Document', documentSchema);
