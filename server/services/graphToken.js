// server/services/graphToken.js
'use strict';

// Ponte entre a sessão do usuário e o Microsoft Graph: guarda o refresh_token
// (cifrado) por identity e entrega um access_token fresco quando o storage precisa.

const crud = require('../crud');
const microsoft = require('../auth/microsoft');
const { encrypt, decrypt } = require('../auth/tokenCrypto');
const logger = require('../logger');

const SYSTEM_USER = 'system:graph';

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Grava/atualiza o refresh token de uma identity (upsert por identity_id).
async function saveRefreshToken(identityId, refresh, scope) {
  if (!refresh) return;
  const enc = encrypt(refresh);
  const existing = await crud.read(
    'ms_oauth_token',
    { where: { identity_id: identityId } },
    null,
    SYSTEM_USER
  );

  if (existing) {
    await crud.update(
      'ms_oauth_token',
      { refresh_token: enc, scope: scope || null, updated_at: new Date() },
      { where: { id: existing.id } },
      SYSTEM_USER
    );
  } else {
    await crud.create(
      'ms_oauth_token',
      { identity_id: identityId, refresh_token: enc, scope: scope || null },
      {},
      SYSTEM_USER
    );
  }
}

async function identityByEmail(email) {
  return crud.read(
    'identity',
    { where: { email: String(email).toLowerCase() } },
    null,
    SYSTEM_USER
  );
}

// Devolve um access_token válido do Graph pra agir como o usuário do e-mail dado.
// Usa o refresh token guardado, e regrava o refresh rotacionado que o Graph devolve.
async function accessTokenForEmail(email) {
  const identity = await identityByEmail(email);
  if (!identity) throw new HttpError(404, 'identity_not_found');

  const row = await crud.read(
    'ms_oauth_token',
    { where: { identity_id: identity.id } },
    null,
    SYSTEM_USER
  );
  if (!row) throw new HttpError(412, 'onedrive_not_connected'); // usuário precisa relogar

  let refresh;
  try {
    refresh = decrypt(row.refresh_token);
  } catch (_e) {
    throw new HttpError(500, 'token_decrypt_failed');
  }

  let tok;
  try {
    tok = await microsoft.refreshToken(refresh);
  } catch (e) {
    logger.warn('graph_refresh_failed', { identity: identity.uuid, error: e.message });
    throw new HttpError(401, 'onedrive_reauth_required'); // refresh revogado/expirado
  }

  if (tok.refresh_token && tok.refresh_token !== refresh) {
    await saveRefreshToken(identity.id, tok.refresh_token, tok.scope);
  }
  return tok.access_token;
}

module.exports = { HttpError, saveRefreshToken, accessTokenForEmail };
