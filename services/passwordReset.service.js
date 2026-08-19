const crypto = require('crypto');
const PasswordReset = require('../models/PasswordReset.model');
const { sendPasswordResetEmail } = require('./email.service');

const RESET_TTL_MS = 5 * 60 * 1000;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function createAndSendPasswordReset(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await PasswordReset.findOneAndUpdate(
    { user: user._id },
    { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await sendPasswordResetEmail({ email: user.email, name: user.name, token });
}

async function consumePasswordReset(token) {
  if (!token || typeof token !== 'string') return null;
  const reset = await PasswordReset.findOneAndDelete({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  return reset ? reset.user : null;
}

module.exports = { createAndSendPasswordReset, consumePasswordReset };
