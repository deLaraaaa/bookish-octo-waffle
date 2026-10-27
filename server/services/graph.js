'use strict';

const GRAPH = 'https://graph.microsoft.com/v1.0';

class GraphError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

async function call(token, path, { method = 'GET', headers = {}, body, raw = false } = {}) {
  const res = await fetch(`${GRAPH}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GraphError(res.status, `graph_${res.status}`, detail.slice(0, 500));
  }
  if (raw) return Buffer.from(await res.arrayBuffer());
  return res.status === 204 ? null : res.json();
}

async function getItemByPath(token, itemPath) {
  const at = itemPath ? `/root:/${encodePath(itemPath)}` : '/root';
  try {
    return await call(token, `/me/drive${at}?$select=id,name,folder`);
  } catch (e) {
    if (e instanceof GraphError && e.status === 404) return null;
    throw e;
  }
}

function encodePath(p) {
  return p.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

async function ensureFolder(token, parentPath, name) {
  const fullPath = parentPath ? `${parentPath}/${name}` : name;
  const existing = await getItemByPath(token, fullPath);
  if (existing && existing.folder) return existing;

  const body = JSON.stringify({
    name,
    folder: {},
    '@microsoft.graph.conflictBehavior': 'fail'
  });
  const parent = parentPath ? `/root:/${encodePath(parentPath)}:` : '/root';
  return call(token, `/me/drive${parent}/children`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  });
}

async function uploadFile(token, filePath, buffer, contentType) {
  return call(token, `/me/drive/root:/${encodePath(filePath)}:/content`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType || 'application/octet-stream' },
    body: buffer
  });
}

async function listChildren(token, folderPath) {
  const at = folderPath ? `/root:/${encodePath(folderPath)}:` : '/root';
  const data = await call(token, `/me/drive${at}/children?$select=id,name,size,lastModifiedDateTime,file`);
  return data.value || [];
}

async function downloadItem(token, itemId) {
  return call(token, `/me/drive/items/${encodeURIComponent(itemId)}/content`, { raw: true });
}

async function itemToPdf(token, itemId) {
  return call(token, `/me/drive/items/${encodeURIComponent(itemId)}/content?format=pdf`, { raw: true });
}

module.exports = {
  GraphError,
  getItemByPath,
  ensureFolder,
  uploadFile,
  listChildren,
  downloadItem,
  itemToPdf
};
