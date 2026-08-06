// server/routes/institutions.js
'use strict';

const express = require('express');
const institution = require('../services/institution');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function sendError(res, { message = 'Internal error', status = 500, stack } = {}) {
  res.status(status).send({ Error: message, Stack: stack });
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const data = await institution.list(req.user);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
