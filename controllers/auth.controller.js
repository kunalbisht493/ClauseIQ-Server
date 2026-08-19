const fs = require('fs/promises');
const User = require('../models/User.model');
const Document = require('../models/Document.model');
const Analysis = require('../models/Analysis.model');
const EmailVerification = require('../models/EmailVerification.model');
const PasswordReset = require('../models/PasswordReset.model');
const { hashPassword, comparePassword, signToken } = require('../services/auth.service');
const { createAndSendVerification, verifyEmail } = require('../services/emailVerification.service');
const { createAndSendPasswordReset, consumePasswordReset } = require('../services/passwordReset.service');
const { deleteChunks } = require('../services/vector.service');

const STRONG_PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const STRONG_PASSWORD_MSG = 'Password must be at least 8 characters long and contain at least one uppercase letter, one lowercase letter, one number, and one special character';

function isStrongPassword(password) {
  return typeof password === 'string' && STRONG_PASSWORD_REGEX.test(password);
}

const isProduction = process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
const authCookieOptions = {
  httpOnly: true,
  sameSite: isProduction ? 'none' : 'lax',
  secure: isProduction,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function setSession(res, user) {
  res.cookie('token', signToken(user), authCookieOptions);
}

async function register(req, res) {
  const { name, password } = req.body;
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email, and password are required' });
  if (!isStrongPassword(password)) return res.status(400).json({ message: STRONG_PASSWORD_MSG });
  if (await User.exists({ email })) return res.status(409).json({ message: 'Email already registered' });

  const shouldAutoVerify = process.env.AUTO_VERIFY_EMAIL !== 'false';
  const user = await User.create({
    name,
    email,
    password: await hashPassword(password),
    emailVerified: shouldAutoVerify,
  });

  if (!shouldAutoVerify) {
    try {
      await createAndSendVerification(user);
    } catch (error) {
      console.error('[AUTH] Failed to send initial verification email:', error.message);
      return res.status(503).json({ message: 'Account created, but the verification email could not be delivered. Please try resending shortly or check your spam folder.' });
    }
    return res.status(201).json({ message: 'Verification email sent', user: { id: user._id, name: user.name, email: user.email, emailVerified: false, hasPassword: true } });
  }

  // Attempt sending welcome/verification email in background if configured, without failing registration
  try {
    await createAndSendVerification(user);
  } catch (_) {
    // Delivery skipped or failed on unverified free domains
  }

  setSession(res, user);
  const token = signToken(user);
  res.status(201).json({
    message: 'Account created successfully!',
    token,
    user: { id: user._id, name: user.name, email: user.email, emailVerified: true, hasPassword: true },
  });
}

async function login(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  if (!user || !(await comparePassword(req.body.password || '', user.password))) return res.status(401).json({ message: 'Invalid email or password' });
  
  if (!user.emailVerified) {
    if (process.env.AUTO_VERIFY_EMAIL !== 'false') {
      user.emailVerified = true;
      await user.save();
    } else {
      return res.status(403).json({ message: 'Please verify your email before logging in' });
    }
  }

  setSession(res, user);
  const token = signToken(user);
  res.json({ token, user: { id: user._id, name: user.name, email: user.email, hasPassword: true } });
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
  const token = signToken(req.user);
  const clientOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  res.redirect(`${clientOrigin}/auth/callback?token=${encodeURIComponent(token)}`);
}

async function confirmEmail(req, res) {
  const user = await verifyEmail(req.query.token);
  if (!user) return res.status(400).json({ message: 'This verification link is invalid or has expired' });
  setSession(res, user);
  const token = signToken(user);
  res.json({ message: 'Email verified.', token, user: { id: user._id, name: user.name, email: user.email, emailVerified: true, hasPassword: true } });
}

async function resendVerification(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Email is required' });
  const user = await User.findOne({ email });
  if (user && !user.emailVerified) {
    try {
      await createAndSendVerification(user);
    } catch (err) {
      console.error('[AUTH] Failed to resend verification email:', err.message);
      return res.status(503).json({ message: 'Could not deliver verification email. Please check your spam folder or verify server email settings.' });
    }
  }
  res.json({ message: 'If an unverified account exists, a verification email has been sent.' });
}

async function requestPasswordReset(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  let resetUrl = null;
  if (email) {
    const user = await User.findOne({ email }).select('+password');
    if (user && user.password) {
      try {
        const { token, emailSent } = await createAndSendPasswordReset(user);
        if (!emailSent) {
          const origin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
          resetUrl = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
        }
      } catch (err) {
        console.error('[AUTH] Failed to create password reset:', err.message);
      }
    }
  }

  if (resetUrl) {
    return res.json({
      message: 'Password reset link ready.',
      resetUrl,
    });
  }

  res.json({ message: 'If an account exists for this email, a password-reset link has been sent.' });
}

async function resetPassword(req, res) {
  const { token, newPassword } = req.body;
  if (!newPassword) return res.status(400).json({ message: 'A new password is required' });
  if (!isStrongPassword(newPassword)) return res.status(400).json({ message: STRONG_PASSWORD_MSG });
  const userId = await consumePasswordReset(token);
  if (!userId) return res.status(400).json({ message: 'This password-reset link is invalid or has expired' });
  const user = await User.findByIdAndUpdate(userId, { $set: { password: await hashPassword(newPassword) } }, { new: true });
  if (!user) return res.status(400).json({ message: 'This password-reset link is invalid or has expired' });
  res.clearCookie('token', authCookieOptions).json({ message: 'Password reset successfully. Please log in.' });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ message: 'A new password is required' });
  }
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ message: STRONG_PASSWORD_MSG });
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
  if (!user) return res.status(401).json({ message: 'Invalid or expired session' });

  if (user.password) {
    if (!currentPassword || !(await comparePassword(currentPassword, user.password))) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
  }

  // `user` is included for documents created before the schema was renamed to
  // `userId`, so deleting an account also cleans up legacy data.
  const documentOwnerFilter = { $or: [{ userId: user._id }, { user: user._id }] };
  const documents = await Document.find(documentOwnerFilter);

  for (const document of documents) {
    // Do not report a successful account deletion while its vector data is
    // still present. The request can safely be retried after Qdrant recovers.
    await deleteChunks(document.vectorNS, document._id);

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
  await Document.deleteMany(documentOwnerFilter);
  await EmailVerification.deleteMany({ user: user._id });
  await PasswordReset.deleteMany({ user: user._id });
  const deletedUser = await User.findByIdAndDelete(user._id);
  if (!deletedUser || await User.exists({ _id: user._id })) {
    const error = new Error('Account could not be deleted');
    error.status = 500;
    throw error;
  }

  res.clearCookie('token', authCookieOptions).json({ message: 'Account deleted', deletedDocuments: documents.length });
}

function logout(_req, res) { res.clearCookie('token', authCookieOptions).status(204).end(); }
module.exports = { register, login, logout, confirmEmail, resendVerification, requestPasswordReset, resetPassword, getCurrentUser, completeGoogleLogin, changePassword, deleteAccount };
