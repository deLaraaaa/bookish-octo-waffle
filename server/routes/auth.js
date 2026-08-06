// server/routes/auth.js
'use strict';

const express = require('express');
const auth = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function sendError(res, { message = 'Internal error', status = 500, stack } = {}) {
  res.status(status).send({ Error: message, Stack: stack });
}

router.get('/microsoft', async (req, res) => {
  try {
    const url = await auth.microsoftAuthUrl();
    res.redirect(url);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/microsoft/callback', async (req, res) => {
  try {
    const url = await auth.handleMicrosoftCallback(req.query);
    res.redirect(url);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/2fa/verify', async (req, res) => {
  try {
    const data = await auth.verifyTwoFactor(req.body || {});
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/2fa/resend', async (req, res) => {
  try {
    const data = await auth.resendTwoFactor(req.body || {});
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const data = await auth.getAccount(req.user);
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/onboarding', requireAuth, async (req, res) => {
  try {
    const data = await auth.submitOnboarding(req.user, req.body || {});
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
