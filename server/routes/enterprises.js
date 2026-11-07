'use strict';

const express = require('express');
const { sendError } = require('../http_errors');
const multer = require('multer');
const enterprise = require('../services/enterprise');
const planilhas = require('../services/exports');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

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

router.get('/export', requireAuth, async (req, res) => {
  try {
    const { workbook } = await planilhas.catalogWorkbook(req.user, {
      search: req.query.search,
      city: req.query.city
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${planilhas.nomeArquivo('empresas-parceiras')}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/manage/export', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const { workbook } = await planilhas.manageWorkbook(req.user, {
      search: req.query.search,
      city: req.query.city,
      status: req.query.status
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${planilhas.nomeArquivo('gestao-parcerias')}"`);
    await workbook.xlsx.write(res);
    res.end();
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

router.get('/all', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    res.send(await enterprise.listAllSelectable(req.user));
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/:uuid/status', requireAuth, requireRole('MANAGER', 'ADMIN'), async (req, res) => {
  try {
    const body = req.body || {};
    const data = await enterprise.updateStatus(req.user, req.params.uuid, body.status, req.requestId, body.reason);
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
