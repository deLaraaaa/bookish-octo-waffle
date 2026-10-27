'use strict';

const crud = require('../crud');
const storage = require('./storage');

const REF_PREFIX = 'onedrive:';

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

function signatureStatusFor(docStatus) {
  switch (docStatus) {
    case 'signed':
    case 'archived':
      return 'signed';
    case 'pending':
      return 'waiting_signature';
    case 'refused':
    case 'expired':
      return 'expired';
    default:
      return 'pending_submission';
  }
}

async function newDocument(actor, name, fileResourceId) {
  const sig = await crud.create(
    'signature',
    { status: 'pending_submission' },
    { returning: ['id'] },
    actor
  );
  return crud.create(
    'document',
    { name: name || 'Contrato', status: 'draft', file_resource_id: fileResourceId, signature_id: sig.id },
    { returning: ['id', 'uuid', 'status'] },
    actor
  );
}

async function syncSignature(actor, documentUuid) {
  const doc = await crud.read(
    'document',
    { select: ['id', 'status', 'signature_id'], where: { uuid: documentUuid } },
    null,
    actor
  );
  if (!doc) return;

  const status = signatureStatusFor(doc.status);
  const signed_date = status === 'signed' ? new Date() : null;

  if (doc.signature_id == null) {
    const sig = await crud.create('signature', { status, signed_date }, { returning: ['id'] }, actor);
    await crud.update(
      'document',
      { signature_id: sig.id },
      { where: { id: doc.id }, returning: ['id'] },
      actor
    );
  } else {
    await crud.update(
      'signature',
      { status, signed_date },
      { where: { id: doc.signature_id }, returning: ['id'] },
      actor
    );
  }
}

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
    return newDocument(actor, name, fr.id);
  }

  const newFr = await crud.create(
    'file_resource',
    { name: name || 'contrato', status: 'uploaded', file_path: itemRef(itemId) },
    { returning: ['id'] },
    actor
  );
  return newDocument(actor, name, newFr.id);
}

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

async function setStatusByItem(actor, { itemId, name, status }) {
  if (!itemId) throw new HttpError(400, 'itemId_required');
  const doc = await ensureDocument(actor, itemId, name);
  const rows = await crud.update(
    'document',
    { status },
    { where: { uuid: doc.uuid }, returning: ['uuid', 'status'] },
    actor
  );
  await syncSignature(actor, doc.uuid);
  return rows[0];
}

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

async function listUnlinked(token, actor) {
  const [files, linked] = await Promise.all([storage.listContracts(token), enterpriseLinkedItemIds(actor)]);

  const groups = new Map();
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

module.exports = { HttpError, ensureDocument, syncSignature, linkToEnterprise, setStatusByItem, listUnlinked, listGenerated };
