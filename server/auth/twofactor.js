// server/auth/twofactor.js
'use strict';

const crypto = require('crypto');
const crud = require('../crud');
const email = require('./email');

const SYSTEM_USER = 'system:auth';
const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutos
const MAX_ATTEMPTS = 5;
const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

function generateCode() {
  // 4 dígitos, sempre com zero à esquerda.
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(`${code}:${SECRET}`).digest('hex');
}

async function issueCode(identity) {
  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_MS);

  await crud.create(
    'two_factor_code',
    {
      identity_id: identity.id,
      code_hash: hashCode(code),
      expires_at: expiresAt
    },
    {},
    SYSTEM_USER
  );

  await email.sendVerificationCode(identity.email, code);
  return { expiresAt };
}

async function verifyCode(identity, code) {
  const rows = await crud.list(
    'two_factor_code',
    {
      where: { identity_id: identity.id, consumed_at: null, active: true },
      orderBy: [{ column: 'insert_date', direction: 'DESC' }],
      limit: 1
    },
    null,
    SYSTEM_USER
  );

  const record = rows[0];
  if (!record) return { ok: false, reason: 'no_code' };

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  const matches = hashCode(String(code)) === record.code_hash;

  if (!matches) {
    await crud.update(
      'two_factor_code',
      { attempts: record.attempts + 1 },
      { where: { id: record.id } },
      SYSTEM_USER
    );
    return { ok: false, reason: 'invalid' };
  }

  // Sucesso: consome o código.
  await crud.update(
    'two_factor_code',
    { consumed_at: new Date() },
    { where: { id: record.id } },
    SYSTEM_USER
  );

  return { ok: true };
}

module.exports = { issueCode, verifyCode, MAX_ATTEMPTS };
