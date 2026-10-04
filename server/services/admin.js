// server/services/admin.js
'use strict';

const crud = require('../crud');
const audit = require('./audit');
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
async function createManagerInvite(actor, body, requestId) {
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
  await audit.record(actor, 'manager.invite', {
    entity: 'role_invite',
    ref: email,
    detail: { promoted_now: !!identity },
    requestId
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
async function revokeManagerInvite(actor, rawEmail, requestId) {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new HttpError(400, 'invalid_email');

  const result = await crud.remove(
    'role_invite',
    { where: { email }, returning: false },
    SYSTEM_USER
  );

  logger.info('manager_invite_revoked', { by: actor && actor.sub, email, removed: result.rowCount });
  if (result.rowCount > 0) {
    await audit.record(actor, 'manager.invite_revoke', {
      entity: 'role_invite',
      ref: email,
      requestId
    });
  }
  return { ok: true, removed: result.rowCount };
}

// Lista as pessoas que são Gestoras hoje (role_id persistido = MANAGER).
async function listManagers() {
  const roleId = await managerRoleId();
  const people = await crud.list(
    'person',
    {
      select: ['id', 'uuid', 'full_name'],
      where: { role_id: roleId, active: true },
      orderBy: [{ column: 'full_name', direction: 'ASC' }]
    },
    null,
    SYSTEM_USER
  );
  if (people.length === 0) return [];

  const identities = await crud.list(
    'identity',
    {
      select: ['person_id', 'email'],
      where: { person_id: { op: 'in', value: people.map((p) => p.id) } }
    },
    null,
    SYSTEM_USER
  );
  const emailByPerson = new Map(identities.map((i) => [String(i.person_id), i.email]));

  return people.map((p) => ({
    uuid: p.uuid,
    name: p.full_name,
    email: emailByPerson.get(String(p.id)) || null
  }));
}

// Rebaixa um Gestor: limpa person.role_id (volta ao papel derivado do domínio)
// e desativa o convite do e-mail, pra pessoa não ser repromovida no login.
// Vale a partir da próxima sessão — o papel vive no JWT até ele expirar.
async function demoteManager(actor, personUuid, requestId) {
  if (!personUuid) throw new HttpError(400, 'uuid_required');

  const person = await crud.read(
    'person',
    { select: ['id', 'uuid', 'full_name', 'role_id'], where: { uuid: personUuid } },
    null,
    SYSTEM_USER
  );
  if (!person) throw new HttpError(404, 'person_not_found');

  const roleId = await managerRoleId();
  if (Number(person.role_id) !== Number(roleId)) throw new HttpError(400, 'not_a_manager');

  await crud.update(
    'person',
    { role_id: null },
    { where: { id: person.id }, returning: false },
    SYSTEM_USER
  );

  const identity = await crud.read(
    'identity',
    { select: ['email'], where: { person_id: person.id } },
    null,
    SYSTEM_USER
  );
  if (identity) {
    // Sem convite correspondente o update só não afeta linhas — não é erro.
    await crud.update(
      'role_invite',
      { active: false },
      { where: { email: normalizeEmail(identity.email) }, returning: false },
      SYSTEM_USER
    );
  }

  logger.info('manager_demoted', { by: actor && actor.sub, person: person.uuid });
  await audit.record(actor, 'manager.demote', {
    entity: 'person',
    ref: (identity && identity.email) || person.uuid,
    detail: { person: person.uuid, name: person.full_name },
    requestId
  });

  return { ok: true };
}

module.exports = {
  HttpError,
  createManagerInvite,
  listManagerInvites,
  revokeManagerInvite,
  listManagers,
  demoteManager
};
