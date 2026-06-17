// server/services/auth.js
'use strict';

const crud = require('../crud');
const tokens = require('../auth/jwt');
const microsoft = require('../auth/microsoft');
const twofactor = require('../auth/twofactor');
const logger = require('../logger');

const SYSTEM_USER = 'system:auth';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const ALLOWED_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || 'catolicasc.edu.br,catolicasc.org.br')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

// Erro com status HTTP, para a rota saber qual código devolver.
class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function emailDomainAllowed(email) {
  const domain = String(email).split('@')[1] || '';
  return ALLOWED_DOMAINS.includes(domain.toLowerCase());
}

function frontendUrl(path, params = {}) {
  const url = new URL(path, FRONTEND_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function findAccountByOid(oid) {
  return crud.read('account', { where: { microsoft_oid: oid } }, null, SYSTEM_USER);
}

function findAccountByEmail(email) {
  return crud.read('account', { where: { email } }, null, SYSTEM_USER);
}

// Deriva o papel a partir do domínio: edu.br -> aluno, org.br -> professor.
async function roleIdForEmail(email) {
  const domain = String(email).split('@')[1] || '';
  const name = domain.toLowerCase().endsWith('edu.br') ? 'aluno' : 'professor';
  const role = await crud.read('role', { select: ['id'], where: { name } }, null, SYSTEM_USER);
  return role ? role.id : null;
}

// Monta a URL de login da Microsoft.
async function microsoftAuthUrl() {
  if (!microsoft.isConfigured()) throw new HttpError(503, 'azure_not_configured');
  const state = tokens.signState({ n: Date.now() });
  return microsoft.authorizeUrl(state);
}

// Processa o callback da Microsoft e resolve a URL de redirecionamento do frontend.
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

    let account = await findAccountByOid(profile.oid);
    let isNew = false;

    if (!account) {
      const byEmail = await findAccountByEmail(profile.email);
      if (byEmail) {
        account = await crud
          .update(
            'account',
            { microsoft_oid: profile.oid, name: byEmail.name || profile.name },
            { where: { id: byEmail.id } },
            SYSTEM_USER
          )
          .then((rows) => rows[0]);
      } else {
        isNew = true;
        account = await crud.create(
          'account',
          {
            name: profile.name,
            email: profile.email,
            microsoft_oid: profile.oid,
            status: 'pending',
            email_verified: false,
            role_id: await roleIdForEmail(profile.email)
          },
          {},
          SYSTEM_USER
        );
      }
    }

    // Exige 2FA na criação da conta (ou enquanto o e-mail não foi verificado).
    if (isNew || !account.email_verified) {
      await twofactor.issueCode(account);
      const challenge = tokens.signChallenge(account);
      logger.info('login_2fa_required', { account: account.uuid, isNew });
      return frontendUrl('/2fa', { challenge });
    }

    const session = tokens.signSession(account);
    logger.info('login_success', { account: account.uuid });
    return frontendUrl('/auth/callback', { token: session });
  } catch (e) {
    logger.error('login_callback_error', { message: e.message });
    return frontendUrl('/login', { error: 'login_failed' });
  }
}

// Verifica os 4 dígitos do 2FA e devolve o token de sessão.
async function verifyTwoFactor({ challenge, code }) {
  if (!challenge || !code) throw new HttpError(400, 'missing_params');

  let claims;
  try {
    claims = tokens.verify(String(challenge), '2fa_challenge');
  } catch (_e) {
    throw new HttpError(401, 'invalid_challenge');
  }

  const account = await crud.read('account', { where: { uuid: claims.sub } }, null, SYSTEM_USER);
  if (!account) throw new HttpError(404, 'account_not_found');

  const result = await twofactor.verifyCode(account, code);
  if (!result.ok) {
    logger.warn('2fa_failed', { account: account.uuid, reason: result.reason });
    throw new HttpError(401, result.reason);
  }

  const updated = await crud
    .update(
      'account',
      { status: 'active', email_verified: true },
      { where: { id: account.id } },
      SYSTEM_USER
    )
    .then((rows) => rows[0]);

  logger.info('2fa_success', { account: account.uuid });
  return { token: tokens.signSession(updated) };
}

// Reenvia o código do 2FA.
async function resendTwoFactor({ challenge }) {
  if (!challenge) throw new HttpError(400, 'missing_params');

  let claims;
  try {
    claims = tokens.verify(String(challenge), '2fa_challenge');
  } catch (_e) {
    throw new HttpError(401, 'invalid_challenge');
  }

  const account = await crud.read('account', { where: { uuid: claims.sub } }, null, SYSTEM_USER);
  if (!account) throw new HttpError(404, 'account_not_found');

  await twofactor.issueCode(account);
  return { ok: true };
}

// Dados da conta logada (inclui papel e status do onboarding).
async function getAccount(userClaims) {
  const account = await crud.read(
    'account',
    {
      select: ['uuid', 'name', 'email', 'status', 'role_id', 'institution_id', 'onboarding_completed'],
      where: { uuid: userClaims.sub }
    },
    null,
    SYSTEM_USER
  );
  if (!account) throw new HttpError(404, 'account_not_found');

  let role = null;
  if (account.role_id) {
    const r = await crud.read('role', { select: ['name'], where: { id: account.role_id } }, null, SYSTEM_USER);
    role = r ? r.name : null;
  }

  return { account: { ...account, role } };
}

// Conclui o onboarding (escolha de unidade + futuras perguntas).
async function submitOnboarding(userClaims, body) {
  const institutionId = Number(body?.institution_id);
  if (!institutionId) throw new HttpError(400, 'institution_required');

  const inst = await crud.read('institution', { where: { id: institutionId } }, null, SYSTEM_USER);
  if (!inst) throw new HttpError(400, 'invalid_institution');

  const updated = await crud
    .update(
      'account',
      { institution_id: institutionId, onboarding_completed: true },
      { where: { uuid: userClaims.sub } },
      SYSTEM_USER
    )
    .then((rows) => rows[0]);

  if (!updated) throw new HttpError(404, 'account_not_found');
  logger.info('onboarding_completed', { account: userClaims.sub });
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
