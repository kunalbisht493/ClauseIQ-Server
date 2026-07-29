const router = require('express').Router();
const { getAnalysis, askQuestion } = require('../controllers/analysis.controller');
const { requireAuth } = require('../middleware/auth.middleware');
router.use(requireAuth);
router.get('/:documentId', getAnalysis);
router.post('/:documentId/questions', askQuestion);
module.exports = router;
