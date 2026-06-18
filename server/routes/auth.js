// server/routes/auth.js
'use strict';

const express = require('express');
const auth = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const onError = (res) => ({ message = 'Internal error', status = 500, stack }) =>
  res.status(status).send({ Error: message, Stack: stack });

router.get('/microsoft', (req, res) => {
  auth.microsoftAuthUrl()
    .then((url) => res.redirect(url))
    .catch(onError(res));
});

router.get('/microsoft/callback', (req, res) => {
  auth.handleMicrosoftCallback(req.query)
    .then((url) => res.redirect(url))
    .catch(onError(res));
});

router.post('/2fa/verify', (req, res) => {
  auth.verifyTwoFactor(req.body || {})
    .then((data) => res.send(data))
    .catch(onError(res));
});

router.post('/2fa/resend', (req, res) => {
  auth.resendTwoFactor(req.body || {})
    .then((data) => res.send(data))
    .catch(onError(res));
});

router.get('/me', requireAuth, (req, res) => {
  auth.getAccount(req.user)
    .then((data) => res.send(data))
    .catch(onError(res));
});

router.post('/onboarding', requireAuth, (req, res) => {
  auth.submitOnboarding(req.user, req.body || {})
    .then((data) => res.send(data))
    .catch(onError(res));
});

module.exports = router;
