'use strict';

const nodemailer = require('nodemailer');
const logger = require('../logger');

let cached = null;

function getTransport() {
  if (cached !== null) return cached;

  const host = process.env.SMTP_HOST;
  if (!host) {
    cached = false;
    return cached;
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure = port === 465;
  cached = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    tls: { minVersion: 'TLSv1.2' }
  });
  return cached;
}

async function sendVerificationCode(to, code) {
  const transport = getTransport();
  const from = process.env.SMTP_FROM || 'Católica SC <noreply@catolicasc.edu.br>';
  const subject = 'Seu código de verificação - Católica SC';
  const text = `Seu código de verificação é ${code}. Ele expira em 10 minutos.`;
  const html =
    `<p>Seu código de verificação é:</p>` +
    `<p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>` +
    `<p>Ele expira em 10 minutos. Se você não solicitou, ignore este e-mail.</p>`;

  if (!transport) {
    logger.warn('two_factor_code_dev', { to, code });
    return { delivered: false, dev: true };
  }

  try {
    await transport.sendMail({ from, to, subject, text, html });
    logger.info('two_factor_code_sent', { to });
    return { delivered: true };
  } catch (e) {
    logger.error('two_factor_code_send_failed', { to, error: e.message });
    logger.warn('two_factor_code_dev', { to, code });
    return { delivered: false, error: e.message };
  }
}

module.exports = { sendVerificationCode };
