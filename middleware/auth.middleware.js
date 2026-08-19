const jwt = require('jsonwebtoken');
const User = require('../models/User.model');

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  const token = req.cookies?.token || bearerToken;
  if (!token) return res.status(401).json({ message: 'Authentication required' });
  try {
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(claims.sub);
    if (!user) return res.status(401).json({ message: 'Invalid or expired session' });
    req.user = user;
    return next();
  }
  catch { return res.status(401).json({ message: 'Invalid or expired session' }); }
}

module.exports = { requireAuth };
