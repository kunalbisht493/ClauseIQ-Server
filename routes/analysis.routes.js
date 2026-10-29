const router = require('express').Router();
const { getAnalysis, askQuestion, askQuestionStream } = require('../controllers/analysis.controller');
const { requireAuth } = require('../middleware/auth.middleware');
router.use(requireAuth);
router.get('/:documentId', getAnalysis);
router.post('/:documentId/questions', askQuestion);
router.post('/:documentId/questions/stream', askQuestionStream);
module.exports = router;
