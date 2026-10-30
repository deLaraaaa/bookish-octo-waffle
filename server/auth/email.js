'use strict';

const nodemailer = require('nodemailer');
const logger = require('../logger');
const graph = require('../services/graph');
const graphToken = require('../services/graphToken');

const TRANSPORTE = String(process.env.MAIL_TRANSPORT || 'auto').toLowerCase();
const PRODUCAO = process.env.NODE_ENV === 'production';

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

function montarMensagem(code) {
  return {
    subject: 'Seu código de verificação - Católica SC',
    text: `Seu código de verificação é ${code}. Ele expira em 10 minutos.`,
    html:
      `<p>Seu código de verificação é:</p>` +
      `<p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>` +
      `<p>Ele expira em 10 minutos. Se você não solicitou, ignore este e-mail.</p>`
  };
}

async function porGraph(to, { subject, text, html }) {
  const token = await graphToken.accessTokenForEmail(to);
  await graph.sendMail(token, { to, subject, text, html });
}

async function porSmtp(to, { subject, text, html }) {
  const transport = getTransport();
  if (!transport) throw new Error('smtp_nao_configurado');

  const from = process.env.SMTP_FROM || 'Católica SC <noreply@catolicasc.edu.br>';
  await transport.sendMail({ from, to, subject, text, html });
}

function caminhos() {
  if (TRANSPORTE === 'graph') return [['graph', porGraph]];
  if (TRANSPORTE === 'smtp') return [['smtp', porSmtp]];
  return [['graph', porGraph], ['smtp', porSmtp]];
}

async function sendVerificationCode(to, code) {
  const mensagem = montarMensagem(code);
  const falhas = [];

  for (const [via, enviar] of caminhos()) {
    try {
      await enviar(to, mensagem);
      logger.info('two_factor_code_sent', { to, via });
      return { delivered: true, via };
    } catch (e) {
      falhas.push(`${via}: ${e.message}`);
      logger.warn('two_factor_code_send_failed', { to, via, error: e.message });
    }
  }

  if (PRODUCAO) {
    logger.error('two_factor_code_undelivered', { to, tentativas: falhas });
    return { delivered: false, error: falhas.join(' | ') };
  }

  logger.warn('two_factor_code_dev', { to, code });
  return { delivered: false, dev: true, error: falhas.join(' | ') };
}

module.exports = { sendVerificationCode };
