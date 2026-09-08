// server/routes/storage.js
'use strict';

// Templates e contratos no OneDrive do usuário logado. Metadados de template no
// banco (tabela template); os arquivos moram no OneDrive. Só MANAGER/ADMIN.

const express = require('express');
const multer = require('multer');
const crud = require('../crud');
const storage = require('../services/storage');
const contracts = require('../services/contracts');
const templateEngine = require('../services/template');
const graph = require('../services/graph');
const graphToken = require('../services/graphToken');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// Templates e contratos são gestão institucional: só Gestor/Admin.
router.use(requireAuth, requireRole('MANAGER', 'ADMIN'));

function fail(res, err) {
  const status = err.status || 500;
  res.status(status).json({ error: err.code || err.message || 'internal_error', details: err.details });
}

// token do Graph pro usuário da sessão (req.user.email vem do JWT)
function tokenFor(req) {
  return graphToken.accessTokenForEmail(req.user.email);
}
function actor(req) {
  return req.user.sub || req.user.email || 'system:storage';
}

// cria as 3 pastas (idempotente) — rodar uma vez por conta
router.post('/setup', async (req, res) => {
  try {
    const token = await tokenFor(req);
    res.json(await storage.ensureStructure(token));
  } catch (err) { fail(res, err); }
});

// IMPORT — sobe um .docx de template (multipart, campo "file") e persiste o metadado
router.post('/templates', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file_required' });
    const token = await tokenFor(req);
    const name = req.body.name || req.file.originalname;
    const up = await storage.importTemplate(token, name, req.file.buffer);
    const row = await crud.create(
      'template',
      {
        name: up.name,
        storage_provider: 'onedrive',
        file_path: up.id, // itemId do .docx em Templates/
        variables: JSON.stringify(up.variables)
      },
      { returning: ['uuid', 'name', 'variables', 'insert_date'] },
      actor(req)
    );
    res.json(row);
  } catch (err) { fail(res, err); }
});

// MESCLAR — reconcilia a pasta Templates/ do OneDrive com a tabela template:
//  - .docx na pasta que não está no banco  -> cadastra (detectando as variáveis)
//  - linha no banco cujo arquivo sumiu      -> desativa
// Deixa OneDrive e sistema iguais.
router.post('/templates/sync', async (req, res) => {
  try {
    const token = await tokenFor(req);
    const [driveFiles, dbRows] = await Promise.all([
      storage.listTemplates(token), // arquivos .docx na pasta (com itemId)
      crud.list('template', { select: ['uuid', 'name', 'file_path'], where: { active: true } }, null, actor(req))
    ]);

    const dbItemIds = new Set(dbRows.map((r) => r.file_path));
    const driveItemIds = new Set(driveFiles.map((f) => f.id));

    const added = [];
    const skipped = [];
    for (const f of driveFiles) {
      if (dbItemIds.has(f.id)) continue;
      let variables;
      try {
        variables = templateEngine.detectVariables(await storage.getTemplate(token, f.id));
      } catch (_e) {
        skipped.push(f.name); // não é um .docx válido
        continue;
      }
      await crud.create(
        'template',
        { name: f.name, storage_provider: 'onedrive', file_path: f.id, variables: JSON.stringify(variables) },
        { returning: false },
        actor(req)
      );
      added.push(f.name);
    }

    const removed = [];
    for (const r of dbRows) {
      if (driveItemIds.has(r.file_path)) continue;
      await crud.update('template', { active: false }, { where: { uuid: r.uuid } }, actor(req));
      removed.push(r.name);
    }

    res.json({ added, removed, skipped });
  } catch (err) { fail(res, err); }
});

// lista os templates cadastrados (do banco)
router.get('/templates', async (req, res) => {
  try {
    const rows = await crud.list(
      'template',
      { select: ['uuid', 'name', 'variables', 'insert_date'], where: { active: true }, orderBy: 'name' },
      null,
      actor(req)
    );
    res.json({ templates: rows });
  } catch (err) { fail(res, err); }
});

// EXPORT — preenche um template e grava o contrato.
// { templateUuid, values, outName, asPdf, enterpriseUuid? } — se vier enterpriseUuid,
// vincula o contrato gerado (PDF quando houver, senão o .docx) à empresa.
router.post('/contracts', async (req, res) => {
  try {
    const { templateUuid, values, outName, asPdf, enterpriseUuid } = req.body || {};
    if (!templateUuid || !outName) return res.status(400).json({ error: 'templateUuid_and_outName_required' });

    const tpl = await crud.read('template', { where: { uuid: templateUuid, active: true } }, null, actor(req));
    if (!tpl) return res.status(404).json({ error: 'template_not_found' });

    const token = await tokenFor(req);
    const out = await storage.exportContract(token, tpl.file_path, values || {}, outName, { asPdf: Boolean(asPdf) });

    if (enterpriseUuid) {
      const file = out.pdf || out.docx; // vincula o PDF quando existir
      const link = await contracts.linkToEnterprise(actor(req), {
        enterpriseUuid,
        itemId: file.id,
        name: file.name
      });
      out.linked = { enterpriseUuid, ...link };
    }
    res.json(out);
  } catch (err) { fail(res, err); }
});

router.get('/contracts', async (req, res) => {
  try {
    const token = await tokenFor(req);
    res.json({ contracts: await contracts.listGenerated(token, actor(req)) });
  } catch (err) { fail(res, err); }
});

// contratos gerados que ainda não estão vinculados a nenhuma empresa
router.get('/contracts/unlinked', async (req, res) => {
  try {
    const token = await tokenFor(req);
    res.json({ contracts: await contracts.listUnlinked(token, actor(req)) });
  } catch (err) { fail(res, err); }
});

// vincula um contrato já gerado a uma empresa { enterpriseUuid, itemId, name }
router.post('/contracts/link', async (req, res) => {
  try {
    const { enterpriseUuid, itemId, name } = req.body || {};
    res.json(await contracts.linkToEnterprise(actor(req), { enterpriseUuid, itemId, name }));
  } catch (err) { fail(res, err); }
});

// atualização MANUAL do status do contrato (interim até o Webdox dirigir isso)
const DOC_STATUSES = new Set(['draft', 'pending', 'signed', 'refused', 'expired', 'archived']);

// por itemId (contratos gerados): garante o document e seta o status
router.patch('/contracts/status', async (req, res) => {
  try {
    const { itemId, name, status } = req.body || {};
    if (!DOC_STATUSES.has(status)) return res.status(400).json({ error: 'invalid_status' });
    res.json(await contracts.setStatusByItem(actor(req), { itemId, name, status }));
  } catch (err) { fail(res, err); }
});

// por uuid do document (contratos já com document — ex.: lista da empresa)
router.patch('/contracts/:documentUuid/status', async (req, res) => {
  try {
    const status = (req.body || {}).status;
    if (!DOC_STATUSES.has(status)) return res.status(400).json({ error: 'invalid_status' });
    const rows = await crud.update(
      'document',
      { status },
      { where: { uuid: req.params.documentUuid }, returning: ['uuid', 'status'] },
      actor(req)
    );
    if (!rows[0]) return res.status(404).json({ error: 'document_not_found' });
    res.json(rows[0]);
  } catch (err) { fail(res, err); }
});

// proxy de download de um item do OneDrive (browser não fala com o Graph direto)
router.get('/download/:itemId', async (req, res) => {
  try {
    const token = await tokenFor(req);
    const buf = await graph.downloadItem(token, req.params.itemId);
    const name = String(req.query.name || 'arquivo');
    const type = /\.pdf$/i.test(name) ? 'application/pdf'
      : /\.docx$/i.test(name) ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`);
    res.send(buf);
  } catch (err) { fail(res, err); }
});

module.exports = router;
