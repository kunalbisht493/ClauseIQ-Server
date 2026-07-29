const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
});
const upload = multer({
  storage,
  limits: { fileSize: Number(process.env.UPLOAD_MAX_FILE_SIZE || 10 * 1024 * 1024) },
  fileFilter: (_req, file, cb) => cb(null, file.mimetype === 'application/pdf'),
});
module.exports = { upload };
