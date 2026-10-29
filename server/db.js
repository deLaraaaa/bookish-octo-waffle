const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL in environment (.env)');
}

const logger = require('./logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

pool.on('error', (err) => {
  logger.error('db_pool_error', { error: err.message });
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };
