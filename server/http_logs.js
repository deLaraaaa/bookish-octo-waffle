// server/http_logs.js
'use strict';

const logger = require('./logger');
const { randomUUID } = require('crypto');

function httpLogs() {
  return (req, res, next) => {
    const requestId = req.headers['x-request-id'] || randomUUID();
    const start = process.hrtime.bigint();

    res.setHeader('x-request-id', requestId);

    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;

      logger.info('http_request', {
        request_id: requestId,
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        duration_ms: Number(ms.toFixed(2)),
        ip: req.ip,
        user_agent: req.headers['user-agent']
      });
    });

    next();
  };
}

module.exports = httpLogs;