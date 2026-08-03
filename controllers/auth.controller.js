const User = require('../models/User.model');
const { hashPassword, comparePassword, signToken } = require('../services/auth.service');
const { createAndSendVerification, verifyEmail } = require('../services/emailVerification.service');

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
  res.status(201).json({ message: 'Verification email sent', user: { id: user._id, name: user.name, email: user.email, emailVerified: false } });
}

async function login(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  if (!user || !(await comparePassword(req.body.password || '', user.password))) return res.status(401).json({ message: 'Invalid email or password' });
  if (!user.emailVerified) return res.status(403).json({ message: 'Please verify your email before logging in' });
  setSession(res, user);
  res.json({ user: { id: user._id, name: user.name, email: user.email } });
}

function getCurrentUser(req, res) {
  res.json({ user: { id: req.user._id, name: req.user.name, email: req.user.email, emailVerified: req.user.emailVerified } });
}

function completeGoogleLogin(req, res) {
  setSession(res, req.user);
  const clientOrigin = (process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
  res.redirect(`${clientOrigin}/auth/callback`);
}

async function confirmEmail(req, res) {
  if (!(await verifyEmail(req.query.token))) return res.status(400).json({ message: 'This verification link is invalid or has expired' });
  res.json({ message: 'Email verified. You can now log in.' });
}

async function resendVerification(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ message: 'Email is required' });
  const user = await User.findOne({ email });
  if (user && !user.emailVerified) await createAndSendVerification(user);
  res.json({ message: 'If an unverified account exists, a verification email has been sent.' });
}

function logout(_req, res) { res.clearCookie('token').status(204).end(); }
module.exports = { register, login, logout, confirmEmail, resendVerification, getCurrentUser, completeGoogleLogin };
