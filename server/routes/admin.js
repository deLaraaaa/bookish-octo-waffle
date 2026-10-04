// server/routes/admin.js
'use strict';

const express = require('express');
const admin = require('../services/admin');
const audit = require('../services/audit');
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
    const data = await admin.createManagerInvite(req.user, req.body || {}, req.requestId);
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
    const data = await admin.revokeManagerInvite(req.user, req.params.email, req.requestId);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Gestores ativos hoje (papel persistido em person.role_id).
router.get('/managers', async (_req, res) => {
  try {
    res.send(await admin.listManagers());
  } catch (err) {
    sendError(res, err);
  }
});

// Rebaixa um Gestor (vale a partir do próximo login — o papel vive no JWT).
router.delete('/managers/:uuid', async (req, res) => {
  try {
    const data = await admin.demoteManager(req.user, req.params.uuid, req.requestId);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Trilha de auditoria (paginada; filtros combináveis: um por coluna).
router.get('/audit-logs', async (req, res) => {
  try {
    const data = await audit.list(req.user, {
      actor: req.query.actor,
      target: req.query.target,
      action: req.query.action,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page
    });
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Sugestões de autocomplete do filtro da trilha (valores já registrados).
router.get('/audit-logs/suggest', async (req, res) => {
  try {
    res.send(await audit.suggest(req.user, { q: req.query.q, field: req.query.field }));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
