const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', apiLimiter);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/documents', require('./routes/document.routes'));
app.use('/api/analyses', require('./routes/analysis.routes'));
app.use(errorHandler);

module.exports = app;
