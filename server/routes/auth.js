'use strict';

const express = require('express');
const { sendError } = require('../http_errors');
const auth = require('../services/auth');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/microsoft', async (req, res) => {
  try {
    res.redirect(await auth.microsoftAuthUrl());
  } catch (err) {
    res.redirect(auth.loginErrorUrl(err));
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
