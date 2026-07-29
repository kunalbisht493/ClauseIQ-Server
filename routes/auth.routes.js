const router = require('express').Router();
const { register, login, logout } = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimiter');
router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/logout', logout);
module.exports = router;
