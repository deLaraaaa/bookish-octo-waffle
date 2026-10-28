'use strict';

const crypto = require('crypto');
const crud = require('../crud');
const email = require('./email');

const SYSTEM_USER = 'system:auth';
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_INTERVAL_MS = 30 * 1000;
const JANELA_MS = 60 * 60 * 1000;
const MAX_CODIGOS_POR_JANELA = 10;
const SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function generateCode() {
  return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

function hashCode(code) {
  return crypto.createHash('sha256').update(`${code}:${SECRET}`).digest('hex');
}

async function codigosRecentes(identity) {
  return crud.list(
    'two_factor_code',
    {
      select: ['id', 'insert_date'],
      where: {
        identity_id: identity.id,
        insert_date: { op: '>=', value: new Date(Date.now() - JANELA_MS) }
      },
      orderBy: [{ column: 'insert_date', direction: 'DESC' }],
      limit: MAX_CODIGOS_POR_JANELA + 1
    },
    null,
    SYSTEM_USER
  );
}

async function issueCode(identity, { respeitarIntervalo = false } = {}) {
  const recentes = await codigosRecentes(identity);

  if (recentes.length >= MAX_CODIGOS_POR_JANELA) {
    throw new HttpError(429, 'too_many_codes');
  }

  if (respeitarIntervalo && recentes[0]) {
    const desdeOUltimo = Date.now() - new Date(recentes[0].insert_date).getTime();
    if (desdeOUltimo < RESEND_INTERVAL_MS) throw new HttpError(429, 'resend_too_soon');
  }

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

  await crud.update(
    'two_factor_code',
    { consumed_at: new Date() },
    { where: { id: record.id } },
    SYSTEM_USER
  );

  return { ok: true };
}

module.exports = {
  HttpError,
  issueCode,
  verifyCode,
  MAX_ATTEMPTS,
  RESEND_INTERVAL_MS,
  MAX_CODIGOS_POR_JANELA
};
