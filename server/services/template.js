// server/services/template.js
'use strict';

const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const InspectModule = require('docxtemplater/js/inspect-module');

const DELIMITERS = { start: '{{', end: '}}' };

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    if (details) this.details = details;
  }
}

function open(buffer, modules = []) {
  let zip;
  try {
    zip = new PizZip(buffer);
  } catch (_e) {
    throw new HttpError(400, 'invalid_docx');
  }
  try {
    return new Docxtemplater(zip, {
      delimiters: DELIMITERS,
      paragraphLoop: true,
      linebreaks: true,
      modules
    });
  } catch (err) {
    throw new HttpError(400, 'invalid_template', explainTemplateError(err));
  }
}

function explainTemplateError(err) {
  const errs = err && err.properties && Array.isArray(err.properties.errors)
    ? err.properties.errors
    : [err];
  return errs.map((e) => ({
    id: (e && e.properties && e.properties.id) || (e && e.name) || 'error',
    tag: e && e.properties && e.properties.xtag,
    explanation: (e && e.properties && e.properties.explanation) || (e && e.message)
  }));
}

function flattenTags(tags, prefix = '') {
  const out = [];
  for (const [key, value] of Object.entries(tags || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && Object.keys(value).length > 0) {
      out.push(...flattenTags(value, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

// Lista as variáveis {{...}} declaradas no .docx.
function detectVariables(buffer) {
  const iModule = new InspectModule();
  open(buffer, [iModule]);
  return [...new Set(flattenTags(iModule.getAllTags()))].sort();
}

function missingVariables(required, values) {
  const v = values || {};
  return required.filter((k) => {
    const val = v[k];
    return val === undefined || val === null || String(val).trim() === '';
  });
}

// Valida e preenche o template, devolvendo o .docx resultante (Buffer).
function fillTemplate(buffer, values) {
  const required = detectVariables(buffer);
  const missing = missingVariables(required, values);
  if (missing.length > 0) {
    throw new HttpError(400, 'missing_variables', { missing });
  }

  const doc = open(buffer);
  try {
    doc.render(values);
  } catch (err) {
    throw new HttpError(400, 'render_failed', explainTemplateError(err));
  }

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = {
  DELIMITERS,
  detectVariables,
  missingVariables,
  fillTemplate,
  HttpError
};
