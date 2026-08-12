const fs = require('fs/promises');
const User = require('../models/User.model');
const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const EmailVerification = require('../models/EmailVerification.model');
const { hashPassword, comparePassword, signToken } = require('../services/auth.service');
const { createAndSendVerification, verifyEmail } = require('../services/emailVerification.service');
const { deleteChunks } = require('../services/vector.service');

function setSession(res, user) {
  res.cookie('token', signToken(user), { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

async function register(req, res) {
  const { name, password } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email, and an 8-character password are required' });
  if (await User.exists({ email })) return res.status(409).json({ message: 'Email already registered' });
  const user = await User.create({ name, email, password: await hashPassword(password) });
  try {
    await createAndSendVerification(user);
  } catch (error) {
    return res.status(503).json({ message: 'Account created, but the verification email could not be sent. Please try again shortly.' });
  }
  res.status(201).json({ message: 'Verification email sent', user: { id: user._id, name: user.name, email: user.email, emailVerified: false, hasPassword: true } });
}

async function login(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  if (!user || !(await comparePassword(req.body.password || '', user.password))) return res.status(401).json({ message: 'Invalid email or password' });
  if (!user.emailVerified) return res.status(403).json({ message: 'Please verify your email before logging in' });
  setSession(res, user);
  res.json({ user: { id: user._id, name: user.name, email: user.email, hasPassword: true } });
}

async function getCurrentUser(req, res) {
  const user = await User.findById(req.user._id).select('+password');
  res.json({
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      hasPassword: Boolean(user.password),
    },
  });
}

function completeGoogleLogin(req, res) {
  setSession(res, req.user);
  const clientOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  res.redirect(`${clientOrigin}/auth/callback`);
}

async function confirmEmail(req, res) {
  const user = await verifyEmail(req.query.token);
  if (!user) return res.status(400).json({ message: 'This verification link is invalid or has expired' });
  setSession(res, user);
  res.json({ message: 'Email verified.', user: { id: user._id, name: user.name, email: user.email, emailVerified: true, hasPassword: true } });
}

async function resendVerification(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Email is required' });
  const user = await User.findOne({ email });
  if (user && !user.emailVerified) await createAndSendVerification(user);
  res.json({ message: 'If an unverified account exists, a verification email has been sent.' });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ message: 'A new password of at least 8 characters is required' });
  }

  const user = await User.findById(req.user._id).select('+password');

  if (user.password) {
    if (!currentPassword || !(await comparePassword(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must be different from your current password' });
    }
  }

  user.password = await hashPassword(newPassword);
  await user.save();

  res.json({ message: 'Password updated successfully' });
}

async function deleteAccount(req, res) {
  const { currentPassword } = req.body;
  const user = await User.findById(req.user._id).select('+password');

  if (user.password) {
    if (!currentPassword || !(await comparePassword(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
  }

  const documents = await Document.find({ userId: user._id });

  for (const document of documents) {
    try {
      await deleteChunks(document.vectorNS, document._id);
    } catch (error) {
      console.error('Failed to delete vector chunks for document', document._id, error);
    }

    if (document.fileUrl) {
      try {
        await fs.unlink(document.fileUrl);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error('Failed to delete file for document', document._id, error);
        }
      }
    }
  }

  await Analysis.deleteMany({ documentId: { $in: documents.map((d) => d._id) } });
  await Document.deleteMany({ userId: user._id });
  await EmailVerification.deleteMany({ user: user._id });
  await User.deleteOne({ _id: user._id });

  res.clearCookie('token').json({ message: 'Account deleted' });
}

function logout(_req, res) { res.clearCookie('token').status(204).end(); }
module.exports = { register, login, logout, confirmEmail, resendVerification, getCurrentUser, completeGoogleLogin, changePassword, deleteAccount };
