// server/services/contractJobs.js
'use strict';

// Geração assíncrona de contratos. O POST /storage/contracts vira um enfileiramento
// (linha em contract_job) e retorna na hora; este worker in-process pega os 'queued',
// roda o export no OneDrive (via Graph) e grava o resultado. O front acompanha pelo uuid.
//
// O worker vive no processo da API: um setInterval que "acorda" a cada tick e drena a
// fila. O enqueue também acorda o worker na hora (wake) pra não esperar o próximo tick.
// Estado mora todo no banco, então reinício do processo não perde jobs (ver recover()).

const db = require('../db');
const crud = require('../crud');
const logger = require('../logger');
const storage = require('./storage');
const contracts = require('./contracts');
const graphToken = require('./graphToken');

const SYSTEM_USER = 'system:contract-job';
const POLL_MS = Number(process.env.CONTRACT_JOB_POLL_MS || 2000);
const MAX_ATTEMPTS = Number(process.env.CONTRACT_JOB_MAX_ATTEMPTS || 3);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// -------------------------- fila (API pública) --------------------------

// Enfileira um pedido de geração. `actor` é o autor (sub/e-mail); `email` re-obtém
// o token do Graph quando o worker rodar. Retorna { uuid, status: 'queued' }.
async function enqueue(actor, email, { templateUuid, values, outName, asPdf, enterpriseUuid }) {
  const row = await crud.create(
    'contract_job',
    {
      template_uuid: templateUuid,
      values: JSON.stringify(values || {}),
      out_name: outName,
      as_pdf: Boolean(asPdf),
      enterprise_uuid: enterpriseUuid || null,
      requested_by: actor,
      requested_by_email: email
    },
    { returning: ['uuid', 'status'] },
    actor
  );
  wake(); // não espera o próximo tick
  return row;
}

// Status de um job pelo uuid (pro polling do front).
async function getByUuid(actor, uuid) {
  const job = await crud.read(
    'contract_job',
    {
      select: ['uuid', 'status', 'result', 'error', 'out_name', 'enterprise_uuid', 'insert_date', 'finished_at'],
      where: { uuid }
    },
    null,
    actor
  );
  if (!job) throw new HttpError(404, 'job_not_found');
  return job;
}

// -------------------------- worker --------------------------

let timer = null;
let ticking = false;

// Reivindica UM job 'queued' de forma atômica (FOR UPDATE SKIP LOCKED): mesmo com
// ticks sobrepostos ou múltiplos processos, cada job sai pra um só. Sem input do
// usuário na query — seguro fora do allowlist do crud (que não expressa esse lock).
const CLAIM_SQL = `
  UPDATE contract_job
  SET status = 'processing', started_at = now(), attempts = attempts + 1
  WHERE id = (
    SELECT id FROM contract_job
    WHERE status = 'queued'
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING id, template_uuid, values, out_name, as_pdf, enterprise_uuid,
            requested_by, requested_by_email, attempts
`;

async function claimNext() {
  const r = await db.query(CLAIM_SQL);
  return r.rows[0] || null;
}

// Faz o trabalho de verdade: mesma sequência do antigo POST síncrono, mas com o
// token re-obtido pelo e-mail do solicitante (não há req aqui).
async function runExport(job) {
  const token = await graphToken.accessTokenForEmail(job.requested_by_email);

  const tpl = await crud.read(
    'template',
    { where: { uuid: job.template_uuid, active: true } },
    null,
    job.requested_by
  );
  if (!tpl) throw new HttpError(404, 'template_not_found');

  const out = await storage.exportContract(token, tpl.file_path, job.values || {}, job.out_name, {
    asPdf: Boolean(job.as_pdf)
  });

  if (job.enterprise_uuid) {
    const file = out.pdf || out.docx; // vincula o PDF quando existir
    const link = await contracts.linkToEnterprise(job.requested_by, {
      enterpriseUuid: job.enterprise_uuid,
      itemId: file.id,
      name: file.name
    });
    out.linked = { enterpriseUuid: job.enterprise_uuid, ...link };
  }
  return out;
}

// 4xx (exceto 408/429) é problema do pedido — não adianta repetir. O resto (5xx,
// rede, token) é transitório: volta pra fila até MAX_ATTEMPTS.
function isPermanent(err) {
  const s = Number(err && err.status);
  return s >= 400 && s < 500 && s !== 408 && s !== 429;
}

function errMessage(err) {
  const base = (err && (err.code || err.message)) || 'error';
  if (err && err.details) {
    try {
      return `${base}: ${JSON.stringify(err.details)}`;
    } catch (_e) {
      return base;
    }
  }
  return base;
}

async function markDone(id, result) {
  await crud.update(
    'contract_job',
    { status: 'done', result: JSON.stringify(result), error: null, finished_at: new Date() },
    { where: { id }, returning: false },
    SYSTEM_USER
  );
}

async function markFailed(id, message) {
  await crud.update(
    'contract_job',
    { status: 'failed', error: message, finished_at: new Date() },
    { where: { id }, returning: false },
    SYSTEM_USER
  );
}

// Devolve o job pra fila (falha transitória): guarda o último erro pra diagnóstico.
async function requeue(id, message) {
  await crud.update(
    'contract_job',
    { status: 'queued', error: message, started_at: null },
    { where: { id }, returning: false },
    SYSTEM_USER
  );
}

async function processJob(job) {
  try {
    const result = await runExport(job);
    await markDone(job.id, result);
  } catch (err) {
    const message = errMessage(err);
    if (isPermanent(err) || job.attempts >= MAX_ATTEMPTS) {
      logger.warn('contract_job_failed', { id: job.id, attempts: job.attempts, error: message });
      await markFailed(job.id, message);
    } else {
      logger.warn('contract_job_retry', { id: job.id, attempts: job.attempts, error: message });
      await requeue(job.id, message);
    }
  }
}

// Drena a fila até não sobrar 'queued'. Reentrância protegida por `ticking`.
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    let job;
    while ((job = await claimNext())) {
      await processJob(job);
    }
  } catch (err) {
    logger.error('contract_job_tick_failed', { error: err.message });
  } finally {
    ticking = false;
  }
}

function wake() {
  tick().catch((err) => logger.error('contract_job_wake_failed', { error: err.message }));
}

// Jobs deixados em 'processing' por um restart no meio do caminho voltam pra fila.
// Worker único: qualquer 'processing' no boot é órfão de um processo que morreu.
async function recover() {
  const rows = await crud.update(
    'contract_job',
    { status: 'queued', started_at: null },
    { where: { status: 'processing' }, returning: ['id'] },
    SYSTEM_USER
  );
  if (rows.length) logger.warn('contract_job_recovered', { count: rows.length });
}

function start() {
  if (timer) return;
  recover()
    .then(() => wake()) // processa o que já estava enfileirado antes do boot
    .catch((err) => logger.warn('contract_job_recover_failed', { error: err.message }));
  timer = setInterval(wake, POLL_MS);
  if (timer.unref) timer.unref(); // não segura o processo vivo sozinho
  logger.info('contract_job_worker_started', { pollMs: POLL_MS });
}

function stop() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { HttpError, enqueue, getByUuid, start, stop };
