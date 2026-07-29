const router = require('express').Router();
const { uploadDocument, listDocuments, getDocument } = require('../controllers/document.controller');
const { requireAuth } = require('../middleware/auth.middleware');
const { upload } = require('../middleware/upload.middleware');
router.use(requireAuth);
router.get('/', listDocuments);
router.post('/', upload.single('file'), uploadDocument);
router.get('/:documentId', getDocument);
module.exports = router;
