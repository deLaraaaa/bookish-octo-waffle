// server/routes/institutions.js
'use strict';

const express = require('express');
const institution = require('../services/institution');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const onError = (res) => ({ message = 'Internal error', status = 500, stack }) =>
  res.status(status).send({ Error: message, Stack: stack });

router.get('/', requireAuth, (req, res) => {
  institution.list(req.user)
    .then((data) => res.send(data))
    .catch(onError(res));
});

module.exports = router;
