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
const CHANCELAS = process.env.ONEDRIVE_CHANCELAS_FOLDER || 'Chancelas';

const templatesPath = `${BASE}/${TEMPLATES}`;
const contractsPath = `${BASE}/${CONTRACTS}`;
const chancelasPath = `${BASE}/${CHANCELAS}`;

const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
function imageExt(name) {
  const m = /\.(png|jpe?g)$/i.exec(String(name));
  return m ? m[1].toLowerCase() : null;
}
function ensureExt(name, ext) {
  return new RegExp(`\\.${ext}$`, 'i').test(name) ? name : `${name}.${ext}`;
}

// Cria as 3 pastas se ainda não existirem (idempotente). Rodar uma vez por conta.
async function ensureStructure(token) {
  await graph.ensureFolder(token, '', BASE);
  await graph.ensureFolder(token, BASE, TEMPLATES);
  await graph.ensureFolder(token, BASE, CONTRACTS);
  await graph.ensureFolder(token, BASE, CHANCELAS);
  return { base: BASE, templatesPath, contractsPath, chancelasPath };
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

// IMPORT — sobe uma imagem de chancela (png/jpg) para a pasta Chancelas/.
async function importSeal(token, name, buffer) {
  const ext = imageExt(name);
  if (!ext) throw Object.assign(new Error('invalid_image'), { status: 400, code: 'invalid_image' });
  await ensureStructure(token); // idempotente: garante Chancelas/ antes do upload
  const fileName = sanitize(name);
  const item = await graph.uploadFile(token, `${chancelasPath}/${fileName}`, buffer, IMAGE_MIME[ext]);
  return { id: item.id, name: item.name };
}

// Grava um PDF já pronto (ex.: contrato chancelado) na pasta de contratos gerados.
async function saveContractPdf(token, outName, buffer) {
  await ensureStructure(token);
  const pdfName = ensureExt(sanitize(outName), 'pdf');
  const item = await graph.uploadFile(token, `${contractsPath}/${pdfName}`, buffer, 'application/pdf');
  return { id: item.id, name: item.name };
}

module.exports = {
  paths: { base: BASE, templatesPath, contractsPath, chancelasPath },
  ensureStructure,
  importTemplate,
  listTemplates,
  getTemplate,
  exportContract,
  listContracts,
  importSeal,
  saveContractPdf
};
