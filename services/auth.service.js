const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const hashPassword = (password) => bcrypt.hash(password, 12);
const comparePassword = (password, hash) => bcrypt.compare(password, hash);
const signToken = (user) => jwt.sign({ sub: user._id, email: user.email }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });

module.exports = { hashPassword, comparePassword, signToken };
