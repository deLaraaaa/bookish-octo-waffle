'use strict';

const express = require('express');
const { sendError } = require('../http_errors');
const institution = require('../services/institution');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  try {
    const data = await institution.list(req.user);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
