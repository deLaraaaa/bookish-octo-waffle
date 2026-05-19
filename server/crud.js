// server/crud.js
'use strict';

const db = require('./db');

/**
 * Security goals:
 * - No SQL injection: values are always parameterized ($1..$n)
 * - Table/column names are validated against a strict allowlist (SCHEMA)
 * - Only a small set of operators is allowed in filters
 * - UPDATE/DELETE require WHERE
 * - All CRUD methods require a `user` argument
 * - Supports legacy-like filters: { AndFilters: [[col, op, value], ...] }
 */

const IDENT_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Tight allowlist of tables/columns.
 * Keep this synced with your schema.sql.
 */
const SCHEMA = Object.freeze({
  role: ['id', 'uuid', 'name', 'insert_date', 'active'],

  institution: [
    'id',
    'uuid',
    'name',
    'street',
    'number',
    'neighborhood',
    'city',
    'state',
    'zip_code',
    'insert_date',
    'active'
  ],

  account: [
    'id',
    'uuid',
    'name',
    'create_date',
    'status',
    'active',
    'role_id',
    'institution_id'
  ],

  signature: ['id', 'uuid', 'status', 'signed_date', 'insert_date', 'active'],

  file_resource: [
    'id',
    'uuid',
    'name',
    'status',
    'insert_date',
    'due_date',
    'file_path',
    'content',
    'signature',
    'active'
  ],

  document: [
    'id',
    'uuid',
    'name',
    'status',
    'insert_date',
    'due_date',
    'active',
    'signature_id',
    'file_resource_id'
  ],

  enterprise: [
    'id',
    'uuid',
    'name',
    'insert_date',
    'street',
    'number',
    'neighborhood',
    'city',
    'state',
    'zip_code',
    'status',
    'active',
    'institution_id'
  ],

  enterprise_document: [
    'id',
    'uuid',
    'enterprise_id',
    'document_id',
    'doc_type',
    'is_primary',
    'insert_date',
    'active'
  ],

  seal: ['id', 'uuid', 'name', 'create_date', 'active', 'file_resource_id']
});

const PUBLIC_READ = Object.freeze({
  account: Object.freeze({
    select: Object.freeze(['id', 'uuid', 'name', 'status', 'active', 'role_id', 'institution_id']),
    whereColumns: Object.freeze(['uuid']),
    allowOps: Object.freeze(['='])
  })
});

function requireUser(user, fnName) {
  if (!user) throw new Error(`${fnName}: user is required`);
  return user;
}

function assertIdent(name, kind) {
  if (typeof name !== 'string' || !IDENT_RE.test(name)) {
    throw new Error(`Invalid ${kind}: ${String(name)}`);
  }
  return name;
}

function assertTable(table) {
  assertIdent(table, 'table');
  if (!Object.prototype.hasOwnProperty.call(SCHEMA, table)) {
    throw new Error(`Table not allowed: ${table}`);
  }
  return table;
}

function assertColumn(table, col) {
  assertIdent(col, 'column');
  const allowed = SCHEMA[table];
  if (!allowed.includes(col)) {
    throw new Error(`Column not allowed: ${table}.${col}`);
  }
  return col;
}

function assertColumns(table, cols) {
  if (!cols) return [];
  if (!Array.isArray(cols)) throw new Error('Columns must be an array');
  return cols.map((c) => assertColumn(table, c));
}

const OPS = new Set([
  '=',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'like',
  'ilike',
  'in',
  'is_null',
  'is_not_null'
]);

function parseAndFilters(table, filterObj) {
  if (!filterObj) return {};

  const andFilters = filterObj.AndFilters || filterObj.andFilters;
  if (!andFilters) return {};

  if (!Array.isArray(andFilters)) throw new Error('AndFilters must be an array');

  const where = {};
  for (const item of andFilters) {
    if (!Array.isArray(item) || item.length < 2) {
      throw new Error(`Invalid AndFilters item: ${JSON.stringify(item)}`);
    }

    const rawCol = item[0];
    const rawOp = item[1];
    const rawVal = item.length >= 3 ? item[2] : undefined;

    const col = assertColumn(table, String(rawCol));

    const opRaw = String(rawOp || '=').trim().toLowerCase();

    const op =
      opRaw === 'in' ? 'in' :
      opRaw === '=' ? '=' :
      opRaw === '!=' ? '!=' :
      opRaw === '<' ? '<' :
      opRaw === '<=' ? '<=' :
      opRaw === '>' ? '>' :
      opRaw === '>=' ? '>=' :
      opRaw === 'like' ? 'like' :
      opRaw === 'ilike' ? 'ilike' :
      opRaw === 'is null' ? 'is_null' :
      opRaw === 'is not null' ? 'is_not_null' :
      opRaw;

    if (!OPS.has(op)) throw new Error(`Operator not allowed: ${op} (${col})`);

    if (op === '=') {
      where[col] = rawVal;
      continue;
    }

    if (op === 'is_null' || op === 'is_not_null') {
      where[col] = { op };
      continue;
    }

    where[col] = { op, value: rawVal };
  }

  return where;
}

function buildWhere(table, where = {}, startIndex = 1) {
  const clauses = [];
  const values = [];
  let idx = startIndex;

  for (const [rawCol, cond] of Object.entries(where || {})) {
    const col = assertColumn(table, rawCol);

    if (cond === undefined) continue;

    if (cond === null) {
      clauses.push(`${col} IS NULL`);
      continue;
    }

    if (typeof cond !== 'object' || Array.isArray(cond)) {
      clauses.push(`${col} = $${idx}`);
      values.push(cond);
      idx += 1;
      continue;
    }

    const op = String(cond.op || '=').toLowerCase();
    if (!OPS.has(op)) throw new Error(`Operator not allowed: ${op}`);

    if (op === 'is_null') {
      clauses.push(`${col} IS NULL`);
      continue;
    }

    if (op === 'is_not_null') {
      clauses.push(`${col} IS NOT NULL`);
      continue;
    }

    if (op === 'in') {
      const arr = cond.value;
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new Error(`IN requires a non-empty array for ${col}`);
      }
      clauses.push(`${col} = ANY($${idx})`);
      values.push(arr);
      idx += 1;
      continue;
    }

    const sqlOp =
      op === 'like' ? 'LIKE' :
      op === 'ilike' ? 'ILIKE' :
      op;

    clauses.push(`${col} ${sqlOp} $${idx}`);
    values.push(cond.value);
    idx += 1;
  }

  return {
    text: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
    nextIndex: idx
  };
}

function buildOrderBy(table, orderBy) {
  if (!orderBy) return '';

  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = items.map((it) => {
    if (typeof it === 'string') {
      const col = assertColumn(table, it);
      return `${col} ASC`;
    }

    const col = assertColumn(table, it.column);
    const dir = String(it.direction || 'ASC').toUpperCase();
    if (!['ASC', 'DESC'].includes(dir)) throw new Error(`Invalid order direction: ${dir}`);
    return `${col} ${dir}`;
  });

  return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
}

function assertLimitOffset(n, label) {
  if (n == null) return null;
  const v = Number(n);
  if (!Number.isInteger(v) || v < 0) throw new Error(`Invalid ${label}: ${n}`);
  return v;
}

function normalizeWhere(table, opts, filters) {
  const whereFromOpts = opts?.where || opts?.filters;
  if (whereFromOpts) return whereFromOpts;

  const whereFromAnd = parseAndFilters(table, filters);
  return whereFromAnd || {};
}

// ------------------------- CRUD -------------------------
async function create(table, data, opts = {}, user) {
  requireUser(user, 'create');
  table = assertTable(table);

  const keys = Object.keys(data || {}).filter((k) => data[k] !== undefined);
  if (keys.length === 0) throw new Error('create: data is empty');

  const cols = keys.map((k) => assertColumn(table, k));
  const values = cols.map((c) => data[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  const returningCols =
    opts.returning === false ? null : (opts.returning ? assertColumns(table, opts.returning) : ['*']);
  const returningSql = returningCols ? `RETURNING ${returningCols.join(', ')}` : '';

  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders}) ${returningSql}`.trim();
  const r = await db.query(sql, values);

  return returningCols ? r.rows[0] : { rowCount: r.rowCount };
}

async function read(table, opts = {}, filters, user) {
  requireUser(user, 'read');
  table = assertTable(table);

  const selectCols = opts.select ? assertColumns(table, opts.select) : ['*'];

  const whereInput = normalizeWhere(table, opts, filters);
  const where = buildWhere(table, whereInput, 1);

  const orderBy = buildOrderBy(table, opts.orderBy);

  const sql = `
    SELECT ${selectCols.join(', ')}
    FROM ${table}
    ${where.text}
    ${orderBy}
    LIMIT 1
  `.trim();

  const r = await db.query(sql, where.values);
  return r.rows[0] || null;
}

async function readPublic(table, opts = {}, filters) {
  table = assertTable(table);

  const policy = PUBLIC_READ[table];
  if (!policy) throw new Error(`readPublic: table not allowed: ${table}`);

  const selectCols = assertColumns(table, policy.select);

  const rawWhere = normalizeWhere(table, opts, filters);

  const whereKeys = Object.keys(rawWhere || {});
  if (whereKeys.length === 0) throw new Error('readPublicExceptional: where is required');
  if (whereKeys.some((k) => !policy.whereColumns.includes(k))) {
    throw new Error(`readPublicExceptional: invalid where columns: ${whereKeys.join(', ')}`);
  }

  const strictWhere = {};
  for (const k of policy.whereColumns) {
    if (!Object.prototype.hasOwnProperty.call(rawWhere, k)) continue;

    const v = rawWhere[k];

    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const op = String(v.op || '').toLowerCase();
      throw new Error(`readPublicExceptional: operator not allowed for ${k}: ${op}`);
    }

    if (v === undefined || v === null) {
      throw new Error(`readPublicExceptional: invalid value for ${k}`);
    }

    strictWhere[k] = v;
  }

  if (Object.keys(strictWhere).length === 0) {
    throw new Error('readPublicExceptional: valid where is required');
  }

  const where = buildWhere(table, strictWhere, 1);

  const sql = `
    SELECT ${selectCols.join(', ')}
    FROM ${table}
    ${where.text}
    ORDER BY id ASC
    LIMIT 1
  `.trim();

  const r = await db.query(sql, where.values);
  return r.rows[0] || null;
}

async function list(table, opts = {}, filters, user) {
  requireUser(user, 'list');
  table = assertTable(table);

  const selectCols = opts.select ? assertColumns(table, opts.select) : ['*'];

  const whereInput = normalizeWhere(table, opts, filters);
  const where = buildWhere(table, whereInput, 1);

  const orderBy = buildOrderBy(table, opts.orderBy);

  const limit = assertLimitOffset(opts.limit, 'limit');
  const offset = assertLimitOffset(opts.offset, 'offset');

  const sql = `
    SELECT ${selectCols.join(', ')}
    FROM ${table}
    ${where.text}
    ${orderBy}
    ${limit != null ? `LIMIT ${limit}` : ''}
    ${offset != null ? `OFFSET ${offset}` : ''}
  `.trim();

  const r = await db.query(sql, where.values);
  return r.rows;
}

async function update(table, patch, opts = {}, user) {
  requireUser(user, 'update');
  table = assertTable(table);

  const whereInput = opts.where || opts.filters;
  if (!whereInput || Object.keys(whereInput).length === 0) {
    throw new Error('update: opts.where is required');
  }

  const keys = Object.keys(patch || {}).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) throw new Error('update: patch is empty');

  const cols = keys.map((k) => assertColumn(table, k));
  const setSql = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const setValues = cols.map((c) => patch[c]);

  const where = buildWhere(table, whereInput, cols.length + 1);

  const returningCols =
    opts.returning === false ? null : (opts.returning ? assertColumns(table, opts.returning) : ['*']);
  const returningSql = returningCols ? `RETURNING ${returningCols.join(', ')}` : '';

  const sql = `
    UPDATE ${table}
    SET ${setSql}
    ${where.text}
    ${returningSql}
  `.trim();

  const r = await db.query(sql, [...setValues, ...where.values]);
  return returningCols ? r.rows : { rowCount: r.rowCount };
}

async function remove(table, opts = {}, user) {
  requireUser(user, 'remove');
  table = assertTable(table);

  const whereInput = opts.where || opts.filters;
  if (!whereInput || Object.keys(whereInput).length === 0) {
    throw new Error('remove: opts.where is required');
  }

  const where = buildWhere(table, whereInput, 1);

  const returningCols =
    opts.returning === false ? null : (opts.returning ? assertColumns(table, opts.returning) : ['*']);
  const returningSql = returningCols ? `RETURNING ${returningCols.join(', ')}` : '';

  const sql = `
    DELETE FROM ${table}
    ${where.text}
    ${returningSql}
  `.trim();

  const r = await db.query(sql, where.values);
  return returningCols ? r.rows : { rowCount: r.rowCount };
}

async function upcreate(table, data, conflict, opts = {}, user) {
  requireUser(user, 'upcreate');
  table = assertTable(table);

  const keys = Object.keys(data || {}).filter((k) => data[k] !== undefined);
  if (keys.length === 0) throw new Error('upcreate: data is empty');

  const cols = keys.map((k) => assertColumn(table, k));
  const values = cols.map((c) => data[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

  let conflictSql = '';
  if (conflict && conflict.constraint) {
    assertIdent(conflict.constraint, 'constraint');
    conflictSql = `ON CONFLICT ON CONSTRAINT ${conflict.constraint}`;
  } else {
    const ccols = assertColumns(table, conflict?.columns || []);
    if (ccols.length === 0) throw new Error('upcreate: conflict.columns or conflict.constraint is required');
    conflictSql = `ON CONFLICT (${ccols.join(', ')})`;
  }

  const updateColumns = opts.updateColumns ? assertColumns(table, opts.updateColumns) : cols;
  const setSql =
    updateColumns.length === 0
      ? 'DO NOTHING'
      : `DO UPDATE SET ${updateColumns.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}`;

  const returningCols =
    opts.returning === false ? null : (opts.returning ? assertColumns(table, opts.returning) : ['*']);
  const returningSql = returningCols ? `RETURNING ${returningCols.join(', ')}` : '';

  const sql = `
    INSERT INTO ${table} (${cols.join(', ')})
    VALUES (${placeholders})
    ${conflictSql}
    ${setSql}
    ${returningSql}
  `.trim();

  const r = await db.query(sql, values);
  return returningCols ? (r.rows[0] || null) : { rowCount: r.rowCount };
}

module.exports = {
  SCHEMA,
  create,
  read,
  readPublic,
  list,
  update,
  remove,
  upcreate
};