require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const db = require('./db');

const httpLogs = require('./http_logs.js');
const { sendError, notFound, errorHandler } = require('./http_errors');
const authRoutes = require('./routes/auth');
const institutionRoutes = require('./routes/institutions');
const enterpriseRoutes = require('./routes/enterprises');
const adminRoutes = require('./routes/admin');
const storageRoutes = require('./routes/storage');
const contractJobs = require('./services/contractJobs');
const app = express();

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000' }));
app.use(express.json());
app.use(httpLogs());

app.get("/health", async (req, res) => {
  try {
    const r = await db.query('select now() as now');
    res.json({ ok: true, now: r.rows[0].now });
  } catch (err) {
    sendError(res, err, { method: req.method, path: req.path, request_id: req.requestId });
  }
});

app.use("/auth", authRoutes);
app.use("/institutions", institutionRoutes);
app.use("/enterprises", enterpriseRoutes);
app.use("/admin", adminRoutes);
app.use("/storage", storageRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  contractJobs.start();
});
