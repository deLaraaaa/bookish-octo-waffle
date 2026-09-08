// server/services/auth.js
'use strict';

const crud = require('../crud');
const tokens = require('../auth/jwt');
const microsoft = require('../auth/microsoft');
const twofactor = require('../auth/twofactor');
const graphToken = require('./graphToken');
const logger = require('../logger');

const SYSTEM_USER = 'system:auth';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
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

function domainOf(email) {
  return String(email).split('@')[1]?.toLowerCase() || '';
}

function emailDomainAllowed(email) {
  return ALLOWED_DOMAINS.includes(domainOf(email));
}

function roleForDomain(domain) {
  return String(domain).toLowerCase().endsWith('edu.br') ? 'TEACHER' : 'STUDENT';
}

function frontendUrl(path, params = {}) {
  const url = new URL(path, FRONTEND_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function findIdentityByOid(oid) {
  return crud.read('identity', { where: { microsoft_oid: oid } }, null, SYSTEM_USER);
}

function readPersonById(id) {
  return crud.read('person', { where: { id } }, null, SYSTEM_USER);
}

async function readRoleId(name) {
  const r = await crud.read('role', { select: ['id'], where: { name } }, null, SYSTEM_USER);
  return r ? r.id : null;
}

async function roleNameById(id) {
  if (id == null) return null;
  const r = await crud.read('role', { select: ['name'], where: { id } }, null, SYSTEM_USER);
  return r ? r.name : null;
}

// Resolve o papel do usuário em três degraus, do mais específico ao padrão:
//   1) person.role_id definido  -> papel persistido (MANAGER/ADMIN)
//   2) convite (role_invite) pendente para o e-mail -> aplica e consome o convite
//   3) fallback: papel derivado do domínio do e-mail (STUDENT/TEACHER)
// O degrau do convite vem DEPOIS do role_id: uma revogação/rebaixamento futuro em
// person.role_id nunca é sobreposto por um convite antigo já consumido.
async function resolveRole(person, email, domain) {
  if (person.role_id != null) {
    const name = await roleNameById(person.role_id);
    if (name) return name;
  }

  const normalizedEmail = String(email || '').toLowerCase();
  const invite = normalizedEmail
    ? await crud.read(
        'role_invite',
        { where: { email: normalizedEmail, active: true, consumed_at: null } },
        null,
        SYSTEM_USER
      )
    : null;

  if (invite) {
    await crud.update(
      'person',
      { role_id: invite.role_id },
      { where: { id: person.id } },
      SYSTEM_USER
    );
    await crud.update(
      'role_invite',
      { consumed_at: new Date() },
      { where: { id: invite.id } },
      SYSTEM_USER
    );
    const name = await roleNameById(invite.role_id);
    if (name) {
      logger.info('role_invite_consumed', { person: person.uuid, role: name });
      return name;
    }
  }

  return roleForDomain(domain);
}

async function microsoftAuthUrl() {
  if (!microsoft.isConfigured()) throw new HttpError(503, 'azure_not_configured');
  const state = tokens.signState({ n: Date.now() });
  return microsoft.authorizeUrl(state);
}

async function resolveIdentity(profile) {
  const domain = domainOf(profile.email);

  let identity = await findIdentityByOid(profile.oid);
  if (identity) {
    const rows = await crud.update(
      'identity',
      { last_login_at: new Date(), email: profile.email, domain },
      { where: { id: identity.id } },
      SYSTEM_USER
    );
    return { identity: rows[0], isNewIdentity: false };
  }

  const person = await crud.create('person', { full_name: profile.name }, {}, SYSTEM_USER);
  identity = await crud.create(
    'identity',
    {
      person_id: person.id,
      provider: 'microsoft',
      microsoft_oid: profile.oid,
      email: profile.email,
      domain,
      email_verified: false,
      last_login_at: new Date()
    },
    {},
    SYSTEM_USER
  );

  return { identity, isNewIdentity: true };
}

async function handleMicrosoftCallback(query) {
  const { code, state, error: oauthError } = query;

  if (oauthError) return frontendUrl('/login', { error: String(oauthError) });
  if (!code || !state) return frontendUrl('/login', { error: 'missing_params' });

  try {
    tokens.verify(String(state), 'oauth_state');
  } catch (_e) {
    return frontendUrl('/login', { error: 'invalid_state' });
  }

  try {
    const tokenSet = await microsoft.exchangeCode(String(code));
    const profile = await microsoft.fetchProfile(tokenSet.access_token);

    if (!profile.email || !emailDomainAllowed(profile.email)) {
      logger.warn('login_domain_rejected', { email: profile.email });
      return frontendUrl('/login', { error: 'domain_not_allowed' });
    }

    const { identity, isNewIdentity } = await resolveIdentity(profile);

    // Guarda o refresh token do Graph pra agir no OneDrive do usuário depois do login.
    if (tokenSet.refresh_token) {
      try {
        await graphToken.saveRefreshToken(identity.id, tokenSet.refresh_token, tokenSet.scope);
      } catch (e) {
        logger.warn('graph_token_save_failed', { identity: identity.uuid, error: e.message });
      }
    }

    logger.info('login_identity', {
      oid: profile.oid,
      domain: domainOf(profile.email),
      reused_identity: !isNewIdentity
    });

    if (!identity.email_verified) {
      await twofactor.issueCode(identity);
      const challenge = tokens.signChallenge(identity);
      logger.info('login_2fa_required', { identity: identity.uuid, isNewIdentity });
      return frontendUrl('/2fa', { challenge });
    }

    const person = await readPersonById(identity.person_id);
    const role = await resolveRole(person, identity.email, identity.domain);
    const session = tokens.signSession(person, role, identity.email);
    logger.info('login_success', { person: person.uuid, role });
    return frontendUrl('/auth/callback', { token: session });
  } catch (e) {
    logger.error('login_callback_error', { name: e.name, error: e.message, stack: e.stack });
    return frontendUrl('/login', { error: 'login_failed' });
  }
}

async function verifyTwoFactor({ challenge, code }) {
  if (!challenge || !code) throw new HttpError(400, 'missing_params');

  let claims;
  try {
    claims = tokens.verify(String(challenge), '2fa_challenge');
  } catch (_e) {
    throw new HttpError(401, 'invalid_challenge');
  }

  const identity = await crud.read('identity', { where: { uuid: claims.sub } }, null, SYSTEM_USER);
  if (!identity) throw new HttpError(404, 'identity_not_found');

  const result = await twofactor.verifyCode(identity, code);
  if (!result.ok) {
    logger.warn('2fa_failed', { identity: identity.uuid, reason: result.reason });
    throw new HttpError(401, result.reason);
  }

  await crud.update(
    'identity',
    { email_verified: true, active: true },
    { where: { id: identity.id } },
    SYSTEM_USER
  );

  const person = await readPersonById(identity.person_id);
  const role = await resolveRole(person, identity.email, identity.domain);
  logger.info('2fa_success', { person: person.uuid, role });
  return { token: tokens.signSession(person, role, identity.email) };
}

async function resendTwoFactor({ challenge }) {
  if (!challenge) throw new HttpError(400, 'missing_params');

  let claims;
  try {
    claims = tokens.verify(String(challenge), '2fa_challenge');
  } catch (_e) {
    throw new HttpError(401, 'invalid_challenge');
  }

  const identity = await crud.read('identity', { where: { uuid: claims.sub } }, null, SYSTEM_USER);
  if (!identity) throw new HttpError(404, 'identity_not_found');

  await twofactor.issueCode(identity);
  return { ok: true };
}

async function getAccount(userClaims) {
  const person = await crud.read(
    'person',
    {
      select: ['uuid', 'full_name', 'institution_id', 'onboarding_completed'],
      where: { uuid: userClaims.sub }
    },
    null,
    SYSTEM_USER
  );
  if (!person) throw new HttpError(404, 'person_not_found');

  const role = userClaims.role || null;
  const roleId = role ? await readRoleId(role) : null;

  let institutionName = null;
  let institutionCity = null;
  if (person.institution_id != null) {
    const inst = await crud.read(
      'institution',
      { select: ['name', 'city'], where: { id: person.institution_id } },
      null,
      SYSTEM_USER
    );
    if (inst) {
      institutionName = inst.name;
      institutionCity = inst.city;
    }
  }

  return {
    account: {
      uuid: person.uuid,
      name: person.full_name,
      email: userClaims.email || null,
      status: 'active',
      role,
      role_id: roleId,
      institution_id: person.institution_id,
      institution_name: institutionName,
      institution_city: institutionCity,
      onboarding_completed: person.onboarding_completed
    }
  };
}

async function submitOnboarding(userClaims, body) {
  const institutionId = Number(body?.institution_id);
  if (!institutionId) throw new HttpError(400, 'institution_required');

  const inst = await crud.read('institution', { where: { id: institutionId } }, null, SYSTEM_USER);
  if (!inst) throw new HttpError(400, 'invalid_institution');

  const rows = await crud.update(
    'person',
    { institution_id: institutionId, onboarding_completed: true },
    { where: { uuid: userClaims.sub } },
    SYSTEM_USER
  );
  const updated = rows[0];

  if (!updated) throw new HttpError(404, 'person_not_found');
  logger.info('onboarding_completed', { person: userClaims.sub });
  return { ok: true };
}

module.exports = {
  HttpError,
  microsoftAuthUrl,
  handleMicrosoftCallback,
  verifyTwoFactor,
  resendTwoFactor,
  getAccount,
  submitOnboarding
};
