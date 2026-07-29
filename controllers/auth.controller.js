const User = require('../models/User.model');
const { hashPassword, comparePassword, signToken } = require('../services/auth.service');

function setSession(res, user) {
  res.cookie('token', signToken(user), { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 7 * 24 * 60 * 60 * 1000 });
}

async function register(req, res) {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: 'Name, email, and an 8-character password are required' });
  if (await User.exists({ email })) return res.status(409).json({ message: 'Email already registered' });
  const user = await User.create({ name, email, password: await hashPassword(password) });
  setSession(res, user);
  res.status(201).json({ user: { id: user._id, name: user.name, email: user.email } });
}

async function login(req, res) {
  const user = await User.findOne({ email: req.body.email }).select('+password');
  if (!user || !(await comparePassword(req.body.password || '', user.password))) return res.status(401).json({ message: 'Invalid email or password' });
  setSession(res, user);
  res.json({ user: { id: user._id, name: user.name, email: user.email } });
}

function logout(_req, res) { res.clearCookie('token').status(204).end(); }
module.exports = { register, login, logout };
