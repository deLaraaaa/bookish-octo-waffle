// server/services/seals.js
'use strict';

// Chancelas: a imagem mora no OneDrive (pasta Chancelas/); aqui persistimos o
// metadado no par file_resource -> seal (seal.file_resource_id, do schema). O
// itemId do OneDrive fica em file_resource.file_path com o prefixo 'onedrive:'
// (mesma convenção dos contratos).

const crud = require('../crud');

const REF_PREFIX = 'onedrive:';
const itemRef = (id) => `${REF_PREFIX}${id}`;
const isRef = (fp) => String(fp || '').startsWith(REF_PREFIX);
const refToItem = (fp) => String(fp).slice(REF_PREFIX.length);

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Persiste uma chancela recém-subida ao OneDrive (file_resource + seal).
async function create(actor, { itemId, name }) {
  const fr = await crud.create(
    'file_resource',
    { name: name || 'chancela', status: 'uploaded', file_path: itemRef(itemId) },
    { returning: ['id'] },
    actor
  );
  const seal = await crud.create(
    'seal',
    { name: name || 'Chancela', file_resource_id: fr.id },
    { returning: ['uuid', 'name'] },
    actor
  );
  return { uuid: seal.uuid, name: seal.name, itemId };
}

// Lista as chancelas ativas com o itemId do OneDrive (pra preview e aplicação).
async function list(actor) {
  const seals = await crud.list(
    'seal',
    { select: ['uuid', 'name', 'file_resource_id'], where: { active: true }, orderBy: 'name' },
    null,
    actor
  );
  const frIds = seals.map((s) => s.file_resource_id).filter((v) => v != null);
  if (!frIds.length) return [];

  const frs = await crud.list(
    'file_resource',
    { select: ['id', 'file_path'], where: { id: { op: 'in', value: frIds } } },
    null,
    actor
  );
  const itemByFr = new Map(frs.filter((f) => isRef(f.file_path)).map((f) => [f.id, refToItem(f.file_path)]));

  return seals
    .map((s) => ({ uuid: s.uuid, name: s.name, itemId: itemByFr.get(s.file_resource_id) || null }))
    .filter((s) => s.itemId);
}

// Resolve o itemId (OneDrive) da imagem de uma chancela pelo uuid.
async function itemIdForUuid(actor, uuid) {
  const seal = await crud.read('seal', { select: ['file_resource_id'], where: { uuid, active: true } }, null, actor);
  if (!seal) throw new HttpError(404, 'seal_not_found');
  const fr = await crud.read('file_resource', { select: ['file_path'], where: { id: seal.file_resource_id } }, null, actor);
  if (!fr || !isRef(fr.file_path)) throw new HttpError(404, 'seal_file_not_found');
  return refToItem(fr.file_path);
}

module.exports = { HttpError, create, list, itemIdForUuid };
