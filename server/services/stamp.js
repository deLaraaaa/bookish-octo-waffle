// server/services/stamp.js
'use strict';

// Carimba uma imagem (chancela) num PDF já existente, via pdf-lib. Recebe os
// buffers do PDF e da imagem e devolve o PDF carimbado (Buffer). Não sabe de
// OneDrive/Graph — quem chama baixa e sobe os arquivos.

const { PDFDocument } = require('pdf-lib');

class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function clamp01(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

// Detecta o tipo pela assinatura de bytes (PNG: 89 50 / JPG: FF D8) — evita
// depender do nome do arquivo pra decidir embedPng vs embedJpg.
function detectImageType(buf) {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  return null;
}

// Posição em frações (0..1) do tamanho da página, medidas do canto SUPERIOR-esquerdo
// (como a tela/preview): xFrac/yFracTop = canto superior-esquerdo da chancela;
// widthFrac = largura. A altura mantém a proporção da imagem. pageIndex null = última.
async function stampImage(pdfBuffer, imageBuffer, { xFrac, yFracTop, widthFrac, pageIndex = null }) {
  const type = detectImageType(imageBuffer);
  if (!type) throw new HttpError(400, 'invalid_image');

  const pdf = await PDFDocument.load(pdfBuffer);
  const img = type === 'jpg' ? await pdf.embedJpg(imageBuffer) : await pdf.embedPng(imageBuffer);

  const pages = pdf.getPages();
  const idx = pageIndex == null ? pages.length - 1 : Number(pageIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= pages.length) throw new HttpError(400, 'invalid_page');

  const page = pages[idx];
  const { width, height } = page.getSize();

  const w = clamp01(widthFrac) * width;
  if (w <= 0) throw new HttpError(400, 'invalid_size');
  const h = (img.height / img.width) * w;
  const x = clamp01(xFrac) * width;
  // Origem do PDF é embaixo-esquerda; a tela mede do topo -> converte o y.
  const y = height - clamp01(yFracTop) * height - h;

  page.drawImage(img, { x, y, width: w, height: h });
  return Buffer.from(await pdf.save());
}

module.exports = { HttpError, stampImage };
