const crypto = require('crypto');
const EmailVerification = require('../models/EmailVerification.model');
const User = require('../models/User.model');
const { sendVerificationEmail } = require('./email.service');

const VERIFICATION_TTL_MS = 5*60 * 1000;
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function createAndSendVerification(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await EmailVerification.findOneAndUpdate(
    { user: user._id },
    { tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFICATION_TTL_MS) },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await sendVerificationEmail({ email: user.email, name: user.name, token });
}

async function verifyEmail(token) {
  if (!token || typeof token !== 'string') return false;
  const verification = await EmailVerification.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } });
  if (!verification) return false;
  await User.updateOne({ _id: verification.user }, { $set: { emailVerified: true } });
  await EmailVerification.deleteOne({ _id: verification._id });
  return true;
}

module.exports = { createAndSendVerification, verifyEmail };
