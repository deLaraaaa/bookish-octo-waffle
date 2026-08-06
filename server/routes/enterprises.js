// server/routes/enterprises.js
'use strict';

const express = require('express');
const multer = require('multer');
const enterprise = require('../services/enterprise');
const { requireAuth } = require('../middleware/auth');

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
    const data = await enterprise.list(req.user, { search: req.query.search });
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
    const data = await enterprise.create(req.user, req.body || {}, req.file);
    res.status(201).send(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
