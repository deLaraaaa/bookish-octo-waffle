// server/services/storage.js
'use strict';

// Import/export dos templates e contratos no OneDrive, sobre a estrutura de 3 pastas:
//   {BASE}/                      (originária)
//   {BASE}/{TEMPLATES}/          (.docx modelo — import)
//   {BASE}/{CONTRACTS}/          (.docx/.pdf gerados — export)
// Agnóstico de tenant: os nomes vêm do .env. Recebe accessToken do chamador.

const graph = require('./graph');
const tpl = require('./template');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const BASE = process.env.ONEDRIVE_BASE_FOLDER || 'Parcerias';
const TEMPLATES = process.env.ONEDRIVE_TEMPLATES_FOLDER || 'Templates';
const CONTRACTS = process.env.ONEDRIVE_CONTRACTS_FOLDER || 'Contratos Gerados';

const templatesPath = `${BASE}/${TEMPLATES}`;
const contractsPath = `${BASE}/${CONTRACTS}`;

// Cria as 3 pastas se ainda não existirem (idempotente). Rodar uma vez por conta.
async function ensureStructure(token) {
  await graph.ensureFolder(token, '', BASE);
  await graph.ensureFolder(token, BASE, TEMPLATES);
  await graph.ensureFolder(token, BASE, CONTRACTS);
  return { base: BASE, templatesPath, contractsPath };
}

function sanitize(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
}

function ensureDocx(name) {
  return /\.docx$/i.test(name) ? name : `${name}.docx`;
}

// IMPORT — sobe um .docx de template. Valida que é docx e devolve as variáveis {{...}}.
async function importTemplate(token, name, buffer) {
  const vars = tpl.detectVariables(buffer); // lança 400 se não for docx válido
  await ensureStructure(token); // idempotente: garante Templates/ antes do upload
  const fileName = ensureDocx(sanitize(name));
  const item = await graph.uploadFile(token, `${templatesPath}/${fileName}`, buffer, DOCX_MIME);
  return { id: item.id, name: item.name, variables: vars };
}

async function listTemplates(token) {
  const items = await graph.listChildren(token, templatesPath);
  return items
    .filter((i) => i.file && /\.docx$/i.test(i.name))
    .map((i) => ({ id: i.id, name: i.name, size: i.size, modified: i.lastModifiedDateTime }));
}

async function getTemplate(token, itemId) {
  return graph.downloadItem(token, itemId); // Buffer
}

// EXPORT — preenche um template com `values` e grava o contrato gerado.
// asPdf: também converte e grava o .pdf ao lado. Devolve os itens criados.
async function exportContract(token, templateId, values, outName, { asPdf = false } = {}) {
  const templateBuffer = await graph.downloadItem(token, templateId);
  const filled = tpl.fillTemplate(templateBuffer, values); // lança 400 se faltar variável

  await ensureStructure(token); // idempotente: garante Contratos Gerados/ antes do upload
  const docxName = ensureDocx(sanitize(outName));
  const docxItem = await graph.uploadFile(token, `${contractsPath}/${docxName}`, filled, DOCX_MIME);
  const result = { docx: { id: docxItem.id, name: docxItem.name } };

  if (asPdf) {
    const pdfBuffer = await graph.itemToPdf(token, docxItem.id);
    const pdfName = docxName.replace(/\.docx$/i, '.pdf');
    const pdfItem = await graph.uploadFile(token, `${contractsPath}/${pdfName}`, pdfBuffer, 'application/pdf');
    result.pdf = { id: pdfItem.id, name: pdfItem.name };
  }
  return result;
}

async function listContracts(token) {
  const items = await graph.listChildren(token, contractsPath);
  return items
    .filter((i) => i.file)
    .map((i) => ({ id: i.id, name: i.name, size: i.size, modified: i.lastModifiedDateTime }));
}

module.exports = {
  paths: { base: BASE, templatesPath, contractsPath },
  ensureStructure,
  importTemplate,
  listTemplates,
  getTemplate,
  exportContract,
  listContracts
};
