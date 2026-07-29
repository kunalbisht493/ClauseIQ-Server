const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

module.exports = { apiLimiter, authLimiter };
