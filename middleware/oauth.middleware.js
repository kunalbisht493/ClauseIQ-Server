const crypto = require('crypto');
const { googleOAuthEnabled } = require('../config/passport');

const stateCookieName = 'google_oauth_state';
const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', maxAge: 10 * 60 * 1000 };

function requireGoogleOAuth(_req, res, next) {
  if (!googleOAuthEnabled) return res.status(503).json({ message: 'Google OAuth is not configured' });
  return next();
}

function setOAuthState(_req, res, next) {
  const state = crypto.randomBytes(32).toString('hex');
  res.cookie(stateCookieName, state, cookieOptions);
  res.locals.oauthState = state;
  next();
}

function verifyOAuthState(req, res, next) {
  const expected = req.cookies[stateCookieName];
  const received = req.query.state;
  res.clearCookie(stateCookieName, cookieOptions);
  if (!expected || typeof received !== 'string' || expected.length !== received.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return res.status(400).json({ message: 'Invalid OAuth state' });
  return next();
}

module.exports = { requireGoogleOAuth, setOAuthState, verifyOAuthState };
