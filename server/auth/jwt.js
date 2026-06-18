// server/auth/jwt.js
'use strict';

const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

if (!process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn('[auth] JWT_SECRET not set; using an insecure development secret.');
}

// sub = uuid da pessoa; role derivado do domínio do login atual.
function signSession(person, role, email, opts = {}) {
  return jwt.sign(
    {
      sub: person.uuid,
      email,
      name: person.full_name,
      role,
      typ: 'session'
    },
    SECRET,
    { expiresIn: opts.expiresIn || '12h' }
  );
}

// sub = uuid da identidade (o e-mail em verificação).
function signChallenge(identity, opts = {}) {
  return jwt.sign(
    { sub: identity.uuid, email: identity.email, typ: '2fa_challenge' },
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
