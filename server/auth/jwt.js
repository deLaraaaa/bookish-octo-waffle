// server/auth/jwt.js
'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

if (!process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('[auth] JWT_SECRET not set; using an insecure development secret.');
}

// Sessão da aplicação (após login + 2FA quando aplicável).
function signSession(account, opts = {}) {
  return jwt.sign(
    {
      sub: account.uuid,
      email: account.email,
      name: account.name,
      role_id: account.role_id ?? null,
      typ: 'session'
    },
    SECRET,
    { expiresIn: opts.expiresIn || '12h' }
  );
}

// Token intermediário emitido entre o login Microsoft e a verificação do 2FA.
function signChallenge(account, opts = {}) {
  return jwt.sign(
    { sub: account.uuid, email: account.email, typ: '2fa_challenge' },
    SECRET,
    { expiresIn: opts.expiresIn || '10m' }
  );
}

// State assinado para proteger o fluxo OAuth contra CSRF.
function signState(payload = {}) {
  return jwt.sign({ ...payload, typ: 'oauth_state' }, SECRET, { expiresIn: '10m' });
}

function verify(token, expectedTyp) {
  const decoded = jwt.verify(token, SECRET);
  if (expectedTyp && decoded.typ !== expectedTyp) {
    throw new Error(`Unexpected token type: ${decoded.typ}`);
  }
  return decoded;
}

module.exports = { signSession, signChallenge, signState, verify };
