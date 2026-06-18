// server/auth/microsoft.js
'use strict';

// Fluxo OAuth2 / OpenID Connect (Authorization Code) com o Microsoft Entra ID (Azure AD).
// Preencha AZURE_* no .env após registrar o app no portal Azure.

const TENANT = process.env.AZURE_TENANT_ID || 'common';
const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`;
const SCOPE = 'openid profile email User.Read';

function config() {
  return {
    clientId: process.env.AZURE_CLIENT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
    redirectUri:
      process.env.AZURE_REDIRECT_URI ||
      'http://localhost:4000/auth/microsoft/callback'
  };
}

function isConfigured() {
  const c = config();
  return Boolean(c.clientId && c.clientSecret);
}

function authorizeUrl(state) {
  const c = config();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: c.redirectUri,
    response_mode: 'query',
    scope: SCOPE,
    prompt: 'select_account', // deixa o usuário escolher a conta
    state
  });
  return `${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
}

async function exchangeCode(code) {
  const c = config();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    scope: SCOPE
  });

  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Token exchange failed (${res.status}): ${detail}`);
  }

  return res.json(); // { access_token, id_token, expires_in, ... }
}

async function fetchProfile(accessToken) {
  const select = ['id', 'displayName', 'mail', 'userPrincipalName'].join(',');
  const res = await fetch(`https://graph.microsoft.com/v1.0/me?$select=${encodeURIComponent(select)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Graph /me failed (${res.status}): ${detail}`);
  }

  const me = await res.json();
  const email = (me.mail || me.userPrincipalName || '').toLowerCase();

  return {
    oid: me.id, // object id estável da conta Microsoft (não muda quando o e-mail é renomeado)
    name: me.displayName || email,
    email
  };
}

module.exports = { isConfigured, authorizeUrl, exchangeCode, fetchProfile };
