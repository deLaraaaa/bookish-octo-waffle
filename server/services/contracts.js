// server/services/contracts.js
'use strict';

// Contratos gerados no OneDrive, encaixados na cadeia file_resource -> document ->
// enterprise_document. Modelo unificado: TODO contrato gerado tem um `document`
// (que carrega o status); vincular a uma empresa é só somar o `enterprise_document`.
// O arquivo mora no OneDrive; guardamos a referência (itemId) em file_resource.file_path.

const crud = require('../crud');
const storage = require('./storage');

const REF_PREFIX = 'onedrive:'; // marca a proveniência da referência em file_path

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const baseName = (name) => String(name).replace(/\.(docx|pdf)$/i, '');
const itemRef = (itemId) => `${REF_PREFIX}${itemId}`;
const isRef = (fp) => String(fp || '').startsWith(REF_PREFIX);
const refToItem = (fp) => String(fp).slice(REF_PREFIX.length);

// Garante um document para um item do OneDrive (cria file_resource + document se
// ainda não existir). Não mexe em vínculo com empresa. Idempotente por itemId.
async function ensureDocument(actor, itemId, name) {
  const fr = await crud.read(
    'file_resource',
    { select: ['id'], where: { active: true, file_path: itemRef(itemId) } },
    null,
    actor
  );
  if (fr) {
    const doc = await crud.read(
      'document',
      { select: ['id', 'uuid', 'status'], where: { file_resource_id: fr.id } },
      null,
      actor
    );
    if (doc) return { id: doc.id, uuid: doc.uuid, status: doc.status };
    const created = await crud.create(
      'document',
      { name: name || 'Contrato', status: 'draft', file_resource_id: fr.id },
      { returning: ['id', 'uuid', 'status'] },
      actor
    );
    return created;
  }

  const newFr = await crud.create(
    'file_resource',
    { name: name || 'contrato', status: 'uploaded', file_path: itemRef(itemId) },
    { returning: ['id'] },
    actor
  );
  return crud.create(
    'document',
    { name: name || 'Contrato', status: 'draft', file_resource_id: newFr.id },
    { returning: ['id', 'uuid', 'status'] },
    actor
  );
}

// Vincula um item do OneDrive a uma empresa. Recusa se o contrato já estiver
// vinculado a alguma empresa (o document liga a no máximo uma).
async function linkToEnterprise(actor, { enterpriseUuid, itemId, name }) {
  if (!enterpriseUuid || !itemId) throw new HttpError(400, 'enterpriseUuid_and_itemId_required');

  const enterprise = await crud.read('enterprise', { select: ['id'], where: { uuid: enterpriseUuid } }, null, actor);
  if (!enterprise) throw new HttpError(404, 'enterprise_not_found');

  const doc = await ensureDocument(actor, itemId, name);

  const existingLink = await crud.read(
    'enterprise_document',
    { select: ['id'], where: { active: true, document_id: doc.id } },
    null,
    actor
  );
  if (existingLink) throw new HttpError(409, 'contract_already_linked');

  await crud.create(
    'enterprise_document',
    { enterprise_id: enterprise.id, document_id: doc.id, doc_type: 'contract', is_primary: false },
    { returning: false },
    actor
  );
  return { document_uuid: doc.uuid };
}

// Atualiza o status de um contrato pelo itemId (garante o document na primeira vez).
async function setStatusByItem(actor, { itemId, name, status }) {
  if (!itemId) throw new HttpError(400, 'itemId_required');
  const doc = await ensureDocument(actor, itemId, name);
  const rows = await crud.update(
    'document',
    { status },
    { where: { uuid: doc.uuid }, returning: ['uuid', 'status'] },
    actor
  );
  return rows[0];
}

// itemIds que estão vinculados a ALGUMA empresa (via enterprise_document).
async function enterpriseLinkedItemIds(actor) {
  const eds = await crud.list('enterprise_document', { select: ['document_id'], where: { active: true } }, null, actor);
  const docIds = eds.map((e) => e.document_id);
  if (!docIds.length) return new Set();
  const docs = await crud.list(
    'document',
    { select: ['file_resource_id'], where: { id: { op: 'in', value: docIds } } },
    null,
    actor
  );
  const frIds = docs.map((d) => d.file_resource_id).filter((v) => v != null);
  if (!frIds.length) return new Set();
  const frs = await crud.list(
    'file_resource',
    { select: ['file_path'], where: { id: { op: 'in', value: frIds } } },
    null,
    actor
  );
  return new Set(frs.filter((f) => isRef(f.file_path)).map((f) => refToItem(f.file_path)));
}

// Contratos gerados no OneDrive que ainda não estão vinculados a nenhuma empresa.
// Agrupa docx+pdf do mesmo contrato (mesmo nome-base), preferindo o PDF.
async function listUnlinked(token, actor) {
  const [files, linked] = await Promise.all([storage.listContracts(token), enterpriseLinkedItemIds(actor)]);

  const groups = new Map(); // base -> { anyLinked, files: [...] }
  for (const f of files) {
    const b = baseName(f.name);
    const g = groups.get(b) || { anyLinked: false, files: [] };
    if (linked.has(f.id)) g.anyLinked = true;
    g.files.push({ itemId: f.id, name: f.name, size: f.size, modified: f.modified, isPdf: /\.pdf$/i.test(f.name) });
    groups.set(b, g);
  }

  const out = [];
  for (const g of groups.values()) {
    if (g.anyLinked) continue;
    const rep = g.files.find((x) => x.isPdf) || g.files[0];
    out.push({ itemId: rep.itemId, name: rep.name, size: rep.size, modified: rep.modified });
  }
  return out;
}

// Contratos gerados (arquivos do OneDrive) enriquecidos com o status do document
// quando existir (document_uuid/status ficam null enquanto ninguém mexeu no status).
async function listGenerated(token, actor) {
  const files = await storage.listContracts(token);

  const frs = await crud.list(
    'file_resource',
    { select: ['id', 'file_path'], where: { active: true, file_path: { op: 'ilike', value: `${REF_PREFIX}%` } } },
    null,
    actor
  );
  const frIdByItem = new Map(frs.filter((f) => isRef(f.file_path)).map((f) => [refToItem(f.file_path), f.id]));
  const frIds = [...frIdByItem.values()];
  const docs = frIds.length
    ? await crud.list(
        'document',
        { select: ['uuid', 'status', 'file_resource_id'], where: { file_resource_id: { op: 'in', value: frIds } } },
        null,
        actor
      )
    : [];
  const docByFr = new Map(docs.map((d) => [d.file_resource_id, d]));

  return files.map((f) => {
    const frId = frIdByItem.get(f.id);
    const doc = frId != null ? docByFr.get(frId) : null;
    return {
      id: f.id,
      name: f.name,
      size: f.size,
      modified: f.modified,
      document_uuid: doc ? doc.uuid : null,
      status: doc ? doc.status : null
    };
  });
}

module.exports = { HttpError, ensureDocument, linkToEnterprise, setStatusByItem, listUnlinked, listGenerated };
