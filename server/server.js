// server/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  const r = await db.query('select now() as now');
  res.json({ ok: true, now: r.rows[0].now });
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});