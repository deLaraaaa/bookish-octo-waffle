// server/scripts/test-smtp.js
// Testa a conexão/autenticação SMTP e envia um e-mail de teste.
// Uso: npm run test:smtp
'use strict';

require('dotenv').config();
const nodemailer = require('nodemailer');

async function main() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('❌ Preencha SMTP_HOST, SMTP_USER e SMTP_PASS no .env primeiro.');
    process.exit(1);
  }

  const port = Number(SMTP_PORT || 587);
  const secure = port === 465;

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2' }
  });

  console.log(`→ Verificando conexão com ${SMTP_HOST}:${port}...`);
  await transport.verify();
  console.log('✓ Conexão e autenticação OK.');

  const to = process.argv[2] || SMTP_USER;
  console.log(`→ Enviando e-mail de teste para ${to}...`);
  const info = await transport.sendMail({
    from: SMTP_FROM || SMTP_USER,
    to,
    subject: 'Teste SMTP - Católica SC',
    text: 'Se você recebeu este e-mail, o SMTP está funcionando.'
  });

  console.log('✓ Enviado:', info.messageId);
}

main().catch((e) => {
  console.error('❌ Falhou:', e.message);
  process.exit(1);
});
