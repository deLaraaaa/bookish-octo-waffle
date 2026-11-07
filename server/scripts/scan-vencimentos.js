'use strict';

require('dotenv').config();

const notifications = require('../services/notifications');
const logger = require('../logger');
const db = require('../db');

async function main() {
  const inicio = Date.now();
  const criadas = await notifications.scanExpiring();

  logger.info('contract_notification_scan', {
    criadas: criadas.length,
    marcos: criadas.reduce((acc, c) => {
      acc[c.milestone] = (acc[c.milestone] || 0) + 1;
      return acc;
    }, {}),
    duration_ms: Date.now() - inicio
  });

  await db.pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  logger.error('contract_notification_scan_failed', { error: err.message });
  try {
    await db.pool.end();
  } catch (_e) {
    logger.error('contract_notification_pool_close_failed', { error: _e.message });
  }
  process.exit(1);
});
