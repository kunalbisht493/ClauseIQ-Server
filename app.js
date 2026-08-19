const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { passport } = require('./config/passport');
const { getQdrant } = require('./config/qdrant');
const { apiLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');

function settleWithin(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Dependency health check timed out')), timeoutMs)),
  ]);
}

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(passport.initialize());
app.use('/api', apiLimiter);

app.get('/health', async (_req, res) => {
  const status = { status: 'ok', mongo: 'unknown', qdrant: 'unknown' };

  try {
    await settleWithin(mongoose.connection.db.admin().ping(), 2_000);
    status.mongo = 'ok';
  } catch (error) {
    status.mongo = 'error';
  }

  try {
    await settleWithin(getQdrant().getCollections(), 2_000);
    status.qdrant = 'ok';
  } catch (error) {
    status.qdrant = 'error';
  }

  res.json(status);
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/documents', require('./routes/document.routes'));
app.use('/api/analyses', require('./routes/analysis.routes'));
app.use(errorHandler);

module.exports = app;
