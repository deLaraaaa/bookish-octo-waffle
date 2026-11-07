'use strict';

const express = require('express');
const notifications = require('../services/notifications');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendError } = require('../http_errors');

const router = express.Router();

router.use(requireAuth, requireRole('MANAGER', 'ADMIN'));

router.get('/', async (req, res) => {
  try {
    const data = await notifications.listForPerson(req.user, {
      unreadOnly: req.query.unread,
      limit: req.query.limit
    });
    res.send(data);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:uuid/read', async (req, res) => {
  try {
    res.send(await notifications.markRead(req.user, req.params.uuid));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/read-all', async (req, res) => {
  try {
    res.send(await notifications.markAllRead(req.user));
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
