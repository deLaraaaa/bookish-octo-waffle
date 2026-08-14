// server/services/admin.js
'use strict';

const crud = require('../crud');
const logger = require('../logger');

const SYSTEM_USER = 'system:admin';

const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'catolicasc.edu.br,catolicasc.org.br')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function domainOf(email) {
  return email.split('@')[1] || '';
}

async function managerRoleId() {
  const r = await crud.read('role', { select: ['id'], where: { name: 'MANAGER' } }, null, SYSTEM_USER);
  if (!r) throw new HttpError(500, 'manager_role_missing');
  return r.id;
}

// Cria (ou revalida) um convite de Gestor para um e-mail. Se já existir uma
// pessoa com esse e-mail (via identity), promove na hora; senão, o convite fica
// pendente e é consumido no primeiro login (ver services/auth.resolveRole).
async function createManagerInvite(actor, body) {
  const email = normalizeEmail(body && body.email);
  if (!email || !email.includes('@')) throw new HttpError(400, 'invalid_email');
  if (!ALLOWED_DOMAINS.includes(domainOf(email))) throw new HttpError(400, 'domain_not_allowed');

  const roleId = await managerRoleId();

  // Já existe login com esse e-mail? Promove imediatamente e marca consumido.
  const identity = await crud.read(
    'identity',
    { select: ['person_id'], where: { email } },
    null,
    SYSTEM_USER
  );
  const consumedAt = identity ? new Date() : null;

  const invite = await crud.upcreate(
    'role_invite',
    { email, role_id: roleId, consumed_at: consumedAt, active: true },
    { columns: ['email'] },
    { updateColumns: ['role_id', 'consumed_at', 'active'], returning: ['id', 'email', 'consumed_at'] },
    SYSTEM_USER
  );

  if (identity) {
    await crud.update(
      'person',
      { role_id: roleId },
      { where: { id: identity.person_id } },
      SYSTEM_USER
    );
  }

  logger.info('manager_invite_created', {
    by: actor && actor.sub,
    email,
    promoted_now: !!identity
  });

  return { email: invite.email, consumed: !!invite.consumed_at, promoted_now: !!identity };
}

async function listManagerInvites() {
  const roleId = await managerRoleId();
  const rows = await crud.list(
    'role_invite',
    {
      select: ['email', 'consumed_at', 'insert_date'],
      where: { role_id: roleId, active: true },
      orderBy: [{ column: 'insert_date', direction: 'DESC' }]
    },
    null,
    SYSTEM_USER
  );
  return rows.map((r) => ({
    email: r.email,
    consumed: !!r.consumed_at,
    invited_at: r.insert_date
  }));
}

// Revoga o convite (allowlist). Apenas bloqueia novas promoções: quem já é
// Gestor continua Gestor — o rebaixamento é uma ação separada de um ADMIN.
async function revokeManagerInvite(actor, rawEmail) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new HttpError(400, 'invalid_email');

  const result = await crud.remove(
    'role_invite',
    { where: { email }, returning: false },
    SYSTEM_USER
  );

  logger.info('manager_invite_revoked', { by: actor && actor.sub, email, removed: result.rowCount });
  return { ok: true, removed: result.rowCount };
}

module.exports = {
  HttpError,
  createManagerInvite,
  listManagerInvites,
  revokeManagerInvite
};
