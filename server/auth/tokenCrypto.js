// server/auth/tokenCrypto.js
'use strict';

// Cifra/decifra segredos curtos (refresh token do Graph) com AES-256-GCM.
// Chave em TOKEN_ENC_KEY (32 bytes em base64 ou hex). Formato: iv:tag:ciphertext (base64).

const crypto = require('crypto');

function key() {
  const raw = process.env.TOKEN_ENC_KEY || '';
  let buf;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) buf = Buffer.from(raw, 'hex');
  else buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error('TOKEN_ENC_KEY inválida — precisa ser 32 bytes (base64 ou hex de 64 chars)');
  }
  return buf;
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString('base64')).join(':');
}

function decrypt(packed) {
  const [ivB64, tagB64, ctB64] = String(packed).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
