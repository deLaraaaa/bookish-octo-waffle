'use strict';

const crud = require('../crud');
const db = require('../db');
const audit = require('./audit');

const SYSTEM_USER = 'system:notifications';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MARCOS = [
  { nome: '3_meses', dias: 90 },
  { nome: '1_mes', dias: 30 },
  { nome: '1_semana', dias: 7 }
];

const DIA_MS = 86400000;

function janelaDoMarco(dias, agora) {
  const inicio = new Date(agora.getTime() + (dias - 1) * DIA_MS);
  const fim = new Date(agora.getTime() + dias * DIA_MS);
  return { inicio, fim };
}

async function scanExpiring(agora = new Date()) {
  const criadas = [];

  for (const marco of MARCOS) {
    const { inicio, fim } = janelaDoMarco(marco.dias, agora);

    const vencendo = await db.query(
      `SELECT d.id, d.due_date
         FROM document d
        WHERE d.status = 'signed'
          AND d.active = true
          AND d.due_date IS NOT NULL
          AND d.due_date >= $1
          AND d.due_date < $2`,
      [inicio, fim]
    );

    for (const doc of vencendo.rows) {
      const inserida = await db.query(
        `INSERT INTO contract_notification (document_id, milestone, due_date)
         VALUES ($1, $2, $3)
         ON CONFLICT (document_id, milestone) DO NOTHING
         RETURNING id, uuid`,
        [doc.id, marco.nome, doc.due_date]
      );
      if (inserida.rows[0]) {
        criadas.push({ ...inserida.rows[0], document_id: doc.id, milestone: marco.nome });
      }
    }
  }

  if (criadas.length) {
    await audit.record(null, 'contract_notification.created', {
      entity: 'contract_notification',
      detail: { total: criadas.length, marcos: criadas.map((c) => c.milestone) }
    });
  }

  return criadas;
}

async function personIdOf(user) {
  const personUuid = user && user.sub;
  if (!personUuid) throw new HttpError(401, 'unauthorized');

  const person = await crud.read(
    'person',
    { select: ['id'], where: { uuid: personUuid } },
    null,
    user || SYSTEM_USER
  );
  if (!person) throw new HttpError(404, 'person_not_found');
  return person.id;
}

async function listForPerson(user, opts = {}) {
  const personId = await personIdOf(user);
  const apenasNaoLidas = opts.unreadOnly === true || opts.unreadOnly === 'true';
  const limite = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);

  const filtroLidas = apenasNaoLidas ? 'AND r.id IS NULL' : '';

  const { rows } = await db.query(
    `SELECT n.uuid,
            n.milestone,
            n.due_date,
            n.insert_date,
            d.uuid AS document_uuid,
            d.name AS document_name,
            e.uuid AS enterprise_uuid,
            e.name AS enterprise_name,
            (r.id IS NOT NULL) AS read
       FROM contract_notification n
       JOIN document d ON d.id = n.document_id
       LEFT JOIN enterprise_document ed ON ed.document_id = d.id
       LEFT JOIN enterprise e ON e.id = ed.enterprise_id
       LEFT JOIN contract_notification_read r
              ON r.notification_id = n.id AND r.person_id = $1
      WHERE d.active = true
        ${filtroLidas}
      ORDER BY n.due_date ASC, n.insert_date DESC
      LIMIT $2`,
    [personId, limite]
  );

  const naoLidas = await db.query(
    `SELECT count(*)::int AS total
       FROM contract_notification n
       JOIN document d ON d.id = n.document_id
       LEFT JOIN contract_notification_read r
              ON r.notification_id = n.id AND r.person_id = $1
      WHERE d.active = true AND r.id IS NULL`,
    [personId]
  );

  return { items: rows, unread: naoLidas.rows[0] ? naoLidas.rows[0].total : 0 };
}

async function markRead(user, uuid) {
  if (!uuid) throw new HttpError(400, 'uuid_required');
  const personId = await personIdOf(user);

  const { rows } = await db.query(
    `INSERT INTO contract_notification_read (notification_id, person_id)
     SELECT n.id, $1 FROM contract_notification n WHERE n.uuid = $2
     ON CONFLICT (notification_id, person_id) DO NOTHING
     RETURNING id`,
    [personId, uuid]
  );

  if (!rows[0]) {
    const existe = await db.query('SELECT 1 FROM contract_notification WHERE uuid = $1', [uuid]);
    if (!existe.rows[0]) throw new HttpError(404, 'notification_not_found');
  }

  return { uuid, read: true };
}

async function markAllRead(user) {
  const personId = await personIdOf(user);

  const { rows } = await db.query(
    `INSERT INTO contract_notification_read (notification_id, person_id)
     SELECT n.id, $1
       FROM contract_notification n
       JOIN document d ON d.id = n.document_id
      WHERE d.active = true
     ON CONFLICT (notification_id, person_id) DO NOTHING
     RETURNING id`,
    [personId]
  );

  return { marked: rows.length };
}

module.exports = {
  MARCOS,
  scanExpiring,
  listForPerson,
  markRead,
  markAllRead,
  HttpError
};
