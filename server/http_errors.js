'use strict';

const logger = require('./logger');

const CODIGO_PADRAO = 'internal_error';

function codeOf(err) {
  if (!err) return CODIGO_PADRAO;
  if (err.type === 'entity.parse.failed') return 'invalid_json';
  if (err.code === 'LIMIT_FILE_SIZE') return 'file_too_large';

  const status = Number(err.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) {
    return err.code || err.message || CODIGO_PADRAO;
  }
  return CODIGO_PADRAO;
}

function statusOf(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') return 413;

  const status = Number(err && err.status);
  return Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
}

function sendError(res, err, contexto = {}) {
  const status = statusOf(err);
  const error = codeOf(err);

  if (status >= 500 || error === CODIGO_PADRAO) {
    logger.error('request_failed', {
      ...contexto,
      code: error,
      error: (err && err.message) || String(err),
      stack: err && err.stack
    });
  }

  const corpo = { error };
  if (err && err.details !== undefined) corpo.details = err.details;
  return res.status(status).json(corpo);
}

function notFound(req, res) {
  res.status(404).json({ error: 'route_not_found' });
}

function errorHandler(err, req, res, _next) {
  sendError(res, err, { method: req.method, path: req.path, request_id: req.requestId });
}

module.exports = { sendError, notFound, errorHandler, codeOf, statusOf };
