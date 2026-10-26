'use strict';


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

function detectImageType(buf) {
  if (buf.length > 3 && buf[0] === 0x89 && buf[1] === 0x50) return 'png';
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'jpg';
  return null;
}

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
  const y = height - clamp01(yFracTop) * height - h;

  page.drawImage(img, { x, y, width: w, height: h });
  return Buffer.from(await pdf.save());
}

module.exports = { HttpError, stampImage };
