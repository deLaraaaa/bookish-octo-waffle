// server/db.js
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('Missing DATABASE_URL in environment (.env)');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query };