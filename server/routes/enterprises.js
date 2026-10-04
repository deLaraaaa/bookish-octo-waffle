// server/routes/enterprises.js
'use strict';

const express = require('express');
const multer = require('multer');
const enterprise = require('../services/enterprise');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// Arquivo opcional do cadastro fica em memória e vai para file_resource.content.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

function sendError(res, { message = 'Internal error', status = 500, stack } = {}) {
  res.status(status).send({ Error: message, Stack: stack });
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const data = await enterprise.list(req.user, {
      search: req.query.search,
      city: req.query.city,
      page: req.query.page
    });
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/mine', requireAuth, async (req, res) => {
  try {
    const data = await enterprise.listMine(req.user);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// --- Gestão (papel MANAGER/ADMIN) ---

// Empresas aguardando análise (status 'pending') + contratos.
router.get('/pending', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const data = await enterprise.listPending(req.user, {
      search: req.query.search,
      page: req.query.page
    });
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Catálogo completo (todos os status) + contratos, para a gestão.
router.get('/manage', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const data = await enterprise.listManage(req.user, {
      search: req.query.search,
      city: req.query.city,
      status: req.query.status,
      page: req.query.page
    });
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

// Todas as empresas ativas (mínimo) para seleção em dropdowns da gestão.
router.get('/all', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    res.send(await enterprise.listAllSelectable(req.user));
  } catch (err) {
    sendError(res, err);
  }
});

// Aprovar/suspender: transição de estado da empresa (pending -> active, etc).
router.patch('/:uuid/status', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const data = await enterprise.updateStatus(req.user, req.params.uuid, (req.body || {}).status, req.requestId);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/cnpj/:cnpj', requireAuth, async (req, res) => {
  try {
    const data = await enterprise.lookupCnpj(req.user, req.params.cnpj);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/', requireAuth, upload.single('document'), async (req, res) => {
  try {
    const data = await enterprise.create(req.user, req.body || {}, req.file, req.requestId);
    res.status(201).send(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
