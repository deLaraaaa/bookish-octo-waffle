// server/middleware/auth.js
'use strict';

const tokens = require('../auth/jwt');

// Protege rotas que exigem sessão válida (JWT no header Authorization: Bearer <token>).
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

module.exports = { requireAuth };
