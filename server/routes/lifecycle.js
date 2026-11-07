'use strict';

const express = require('express');
const lifecycle = require('../services/lifecycle');
const { requireAuth } = require('../middleware/auth');
const { sendError } = require('../http_errors');

const router = express.Router();

router.use(requireAuth);

router.get('/', async (_req, res) => {
  try {
    res.send({ machines: lifecycle.MAQUINAS });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
