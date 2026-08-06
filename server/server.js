// server/server.js
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const db = require('./db');

const httpLogs = require('./http_logs.js');
const authRoutes = require('./routes/auth');
const institutionRoutes = require('./routes/institutions');
const enterpriseRoutes = require('./routes/enterprises');
const app = express();

app.use(cors());
app.use(express.json());
app.use(httpLogs());

app.get("/health", async (_req, res) => {
  const r = await db.query('select now() as now');
  res.json({ ok: true, now: r.rows[0].now });
});

app.use("/auth", authRoutes);
app.use("/institutions", institutionRoutes);
app.use("/enterprises", enterpriseRoutes);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
