'use strict';

const crud = require('../crud');
const logger = require('../logger');

const SYSTEM_USER = 'system:audit';
const PAGE_SIZE = 10;

async function record(actor, action, { entity, ref = null, detail = null, requestId = null } = {}) {
  try {
    await crud.create(
      'audit_log',
      {
        actor_uuid: actor && actor.sub,
        actor_email: (actor && actor.email) || null,
        action,
        entity,
        entity_ref: ref,
        detail,
        request_id: requestId
      },
      { returning: false },
      SYSTEM_USER
    );
  } catch (e) {
    logger.error('audit_record_failed', { action, entity, error: e.message });
  }
}

const SEARCH_FIELDS = { actor: 'actor_email', target: 'entity_ref' };

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function parseDay(v) {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function list(user, opts = {}) {
  const actor = user || SYSTEM_USER;
  const page = Math.max(1, Math.floor(Number(opts.page)) || 1);

  const where = {};
  const action = str(opts.action);
  if (action) where.action = action;
  const actorQ = str(opts.actor);
  if (actorQ) where.actor_email = { op: 'ilike', value: `%${actorQ}%` };
  const targetQ = str(opts.target);
  if (targetQ) where.entity_ref = { op: 'ilike', value: `%${targetQ}%` };

  const range = [];
  const from = parseDay(opts.from);
  if (from) range.push({ op: '>=', value: from });
  const to = parseDay(opts.to);
  if (to) {
    const next = new Date(to);
    next.setDate(next.getDate() + 1);
    range.push({ op: '<', value: next });
  }
  if (range.length) where.insert_date = range;

  const rows = await crud.list(
    'audit_log',
    {
      select: ['id', 'actor_email', 'action', 'entity', 'entity_ref', 'detail', 'insert_date'],
      where,
      orderBy: [{ column: 'insert_date', direction: 'DESC' }, { column: 'id', direction: 'DESC' }],
      limit: PAGE_SIZE + 1,
      offset: (page - 1) * PAGE_SIZE
    },
    null,
    actor
  );

  return {
    items: rows.slice(0, PAGE_SIZE),
    page,
    pageSize: PAGE_SIZE,
    hasMore: rows.length > PAGE_SIZE
  };
}

async function suggest(user, opts = {}) {
  const actor = user || SYSTEM_USER;
  const q = str(opts.q);
  if (q.length < 2) return [];
  const column = SEARCH_FIELDS[opts.field] || SEARCH_FIELDS.target;

  const rows = await crud.list(
    'audit_log',
    {
      select: [column],
      where: { [column]: { op: 'ilike', value: `%${q}%` } },
      orderBy: [{ column: 'insert_date', direction: 'DESC' }],
      limit: 100
    },
    null,
    actor
  );

  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const value = r[column];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= 8) break;
  }
  return out;
}

module.exports = { record, list, suggest };
