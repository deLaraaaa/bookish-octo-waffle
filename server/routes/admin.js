// server/routes/admin.js
'use strict';

const express = require('express');
const admin = require('../services/admin');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function sendError(res, { message = 'Internal error', status = 500, stack } = {}) {
  res.status(status).send({ Error: message, Stack: stack });
}

// Toda administração exige sessão com papel ADMIN. A regra vive aqui, no
// backend: qualquer outro papel recebe 403 (nunca confiar só na UI).
router.use(requireAuth, requireRole('ADMIN'));

// Convida um e-mail para virar Gestor (promove na hora se já existir login).
router.post('/manager-invites', async (req, res) => {
  try {
    const data = await admin.createManagerInvite(req.user, req.body || {});
    res.status(201).send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Lista os convites de Gestor e seu estado (consumido ou pendente).
router.get('/manager-invites', async (_req, res) => {
  try {
    const data = await admin.listManagerInvites();
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Revoga um convite (só bloqueia novas promoções).
router.delete('/manager-invites/:email', async (req, res) => {
  try {
    const data = await admin.revokeManagerInvite(req.user, req.params.email);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
