// server/middleware/auth.js
'use strict';

const tokens = require('../auth/jwt');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);

  if (!match) {
    return res.status(401).json({ error: 'missing_token' });
  }

  try {
    req.user = tokens.verify(match[1], 'session');
    next();
  } catch (_e) {
    res.status(401).json({ error: 'invalid_token' });
  }
}

// Autorização por papel. Deve rodar depois de requireAuth (usa req.user.role).
// A regra vive no backend: nunca confiar só na UI para esconder ações.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
