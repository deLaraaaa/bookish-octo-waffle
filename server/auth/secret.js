'use strict';

const TAMANHO_MINIMO = 32;

function jwtSecret() {
  const valor = String(process.env.JWT_SECRET || '').trim();

  if (!valor) {
    throw new Error('JWT_SECRET não definida. Gere uma com: openssl rand -base64 48');
  }

  if (valor.length < TAMANHO_MINIMO) {
    throw new Error(
      `JWT_SECRET curta demais: ${valor.length} caracteres, mínimo ${TAMANHO_MINIMO}. ` +
        'Gere uma com: openssl rand -base64 48'
    );
  }

  return valor;
}

module.exports = { jwtSecret, TAMANHO_MINIMO };
