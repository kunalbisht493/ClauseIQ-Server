const jwt = require('jsonwebtoken');

function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); return next(); }
  catch { return res.status(401).json({ message: 'Invalid or expired session' }); }
}

module.exports = { requireAuth };
