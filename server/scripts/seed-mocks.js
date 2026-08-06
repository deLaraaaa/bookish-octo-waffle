// server/scripts/seed-mocks.js
//
// Popula dados de exemplo (mock) para desenvolvimento:
//   enterprise -> enterprise_document -> document -> (signature, file_resource)
//
// Uma "empresa completa" = empresa + seus contratos/documentos, cada um com
// arquivo (file_resource) e fluxo de assinatura (signature). Os contratos são
// criados em status variados (draft, pending, signed, refused, expired, archived).
//
// Algumas empresas são atribuídas ao usuário person id = 2 (created_by_person_id),
// simulando as "Minhas empresas — cadastradas por você".
//
// Idempotente: usa UUIDs determinísticos (uuidv5) + ON CONFLICT, então pode
// rodar quantas vezes quiser sem duplicar.
//
// Uso:  node scripts/seed-mocks.js

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });

const { v5: uuidv5 } = require('uuid');
const db = require('../db');

// Namespace fixo para gerar UUIDs estáveis a partir de nomes legíveis.
const NS = 'a3b1e2c4-0000-4000-8000-000000000001';
const uid = (name) => uuidv5(name, NS);

const OWNER_PERSON_ID = 2; // usuário dono de "Minhas empresas"

// Datas relativas (script Node comum — Date é permitido aqui).
const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

// Mapeia o status do contrato -> status/registro de assinatura coerente.
function signatureFor(docStatus) {
  switch (docStatus) {
    case 'signed':
    case 'archived':
      return { status: 'signed', signedDate: daysFromNow(-20) };
    case 'pending':
      return { status: 'waiting_signature', signedDate: null };
    case 'draft':
      return { status: 'pending_submission', signedDate: null };
    case 'refused':
    case 'expired':
      return { status: 'expired', signedDate: null };
    default:
      return { status: 'pending_submission', signedDate: null };
  }
}

// slug -> usado só para gerar UUIDs determinísticos por empresa/documento.
const ENTERPRISES = [
  {
    slug: 'weg',
    name: 'WEG S.A.',
    institutionId: 1,
    ownerId: OWNER_PERSON_ID,
    responsible: 'Carlos Schmidt',
    phone: '(47) 3276-4000',
    street: 'Av. Prefeito Waldemar Grubba',
    number: '3300',
    neighborhood: 'Vila Lalau',
    city: 'Jaraguá do Sul',
    state: 'SC',
    zip: '89256-900',
    docs: [
      { name: 'Contrato de Estágio — WEG', status: 'signed', type: 'contract', primary: true },
      { name: 'Aditivo de Vigência — WEG', status: 'pending', type: 'contract' },
    ],
  },
  {
    slug: 'malwee',
    name: 'Malwee Malhas',
    institutionId: 1,
    ownerId: OWNER_PERSON_ID,
    responsible: 'Fernanda Reichow',
    phone: '(47) 3372-7000',
    street: 'Rua Bertha Weege',
    number: '200',
    neighborhood: 'Barra do Rio Cerro',
    city: 'Jaraguá do Sul',
    state: 'SC',
    zip: '89260-500',
    docs: [
      { name: 'Convênio de Extensão — Malwee', status: 'draft', type: 'contract', primary: true },
      { name: 'Cartão CNPJ — Malwee', status: 'archived', type: 'cnpj' },
    ],
  },
  {
    slug: 'marisol',
    name: 'Marisol S.A.',
    institutionId: 1,
    ownerId: null,
    responsible: 'João Batista Menegotti',
    phone: '(47) 3372-9000',
    street: 'Rua Bernardo Dornbusch',
    number: '1300',
    neighborhood: 'Baependi',
    city: 'Jaraguá do Sul',
    state: 'SC',
    zip: '89256-100',
    docs: [
      { name: 'Contrato de Estágio — Marisol', status: 'expired', type: 'contract', primary: true },
    ],
  },
  {
    slug: 'duasrodas',
    name: 'Duas Rodas Industrial',
    institutionId: 1,
    ownerId: OWNER_PERSON_ID,
    responsible: 'Ricardo Zimmermann',
    phone: '(47) 3372-1000',
    street: 'Rua Guilherme Weege',
    number: '380',
    neighborhood: 'Centro',
    city: 'Jaraguá do Sul',
    state: 'SC',
    zip: '89252-000',
    docs: [
      { name: 'Termo de Convênio — Duas Rodas', status: 'refused', type: 'contract', primary: true },
      { name: 'Contrato de Estágio — Duas Rodas', status: 'signed', type: 'contract' },
    ],
  },
  {
    slug: 'netzsch',
    name: 'Netzsch do Brasil',
    institutionId: 2,
    ownerId: null,
    responsible: 'Angela Bauer',
    phone: '(47) 3451-0000',
    street: 'Rua Anhanguera',
    number: '210',
    neighborhood: 'Costa e Silva',
    city: 'Joinville',
    state: 'SC',
    zip: '89218-100',
    docs: [
      { name: 'Contrato de Estágio — Netzsch', status: 'signed', type: 'contract', primary: true },
    ],
  },
  {
    slug: 'tupy',
    name: 'Tupy S.A.',
    institutionId: 2,
    ownerId: OWNER_PERSON_ID,
    responsible: 'Marcelo Costa',
    phone: '(47) 4009-8000',
    street: 'Rua Albano Schmidt',
    number: '3400',
    neighborhood: 'Boa Vista',
    city: 'Joinville',
    state: 'SC',
    zip: '89206-001',
    docs: [
      { name: 'Aditivo de Convênio — Tupy', status: 'pending', type: 'contract', primary: true },
      { name: 'Minuta de Contrato — Tupy', status: 'draft', type: 'contract' },
    ],
  },
  {
    slug: 'docol',
    name: 'Docol Metais Sanitários',
    institutionId: 2,
    ownerId: null,
    responsible: 'Patrícia Lima',
    phone: '(47) 3451-5000',
    street: 'Rua Dona Francisca',
    number: '6901',
    neighborhood: 'Distrito Industrial',
    city: 'Joinville',
    state: 'SC',
    zip: '89219-600',
    docs: [
      { name: 'Contrato de Estágio — Docol', status: 'archived', type: 'contract', primary: true },
    ],
  },
  {
    slug: 'embraco',
    name: 'Embraco (Nidec GA)',
    institutionId: 2,
    ownerId: null,
    responsible: 'Henrique Steiner',
    phone: '(47) 3441-2121',
    street: 'Rua Rui Barbosa',
    number: '1020',
    neighborhood: 'Iririú',
    city: 'Joinville',
    state: 'SC',
    zip: '89227-901',
    docs: [
      { name: 'Convênio de Extensão — Embraco', status: 'expired', type: 'contract', primary: true },
      { name: 'Cartão CNPJ — Embraco', status: 'signed', type: 'cnpj' },
    ],
  },
];

async function upsertEnterprise(client, e) {
  const { rows } = await client.query(
    `INSERT INTO enterprise
       (uuid, name, responsible_person, phone_number,
        street, number, neighborhood, city, state, zip_code,
        status, active, institution_id, created_by_person_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',true,$11,$12)
     ON CONFLICT (uuid) DO UPDATE SET
       name = EXCLUDED.name,
       responsible_person = EXCLUDED.responsible_person,
       phone_number = EXCLUDED.phone_number,
       street = EXCLUDED.street,
       number = EXCLUDED.number,
       neighborhood = EXCLUDED.neighborhood,
       city = EXCLUDED.city,
       state = EXCLUDED.state,
       zip_code = EXCLUDED.zip_code,
       institution_id = EXCLUDED.institution_id,
       created_by_person_id = EXCLUDED.created_by_person_id
     RETURNING id`,
    [
      uid(`enterprise:${e.slug}`), e.name, e.responsible, e.phone,
      e.street, e.number, e.neighborhood, e.city, e.state, e.zip,
      e.institutionId, e.ownerId,
    ]
  );
  return rows[0].id;
}

async function upsertDocumentChain(client, e, enterpriseId, doc, idx) {
  const sig = signatureFor(doc.status);
  const sigUuid = uid(`signature:${e.slug}:${idx}`);
  const fileUuid = uid(`file:${e.slug}:${idx}`);
  const docUuid = uid(`document:${e.slug}:${idx}`);
  const linkUuid = uid(`enterprise_document:${e.slug}:${idx}`);

  const { rows: sigRows } = await client.query(
    `INSERT INTO signature (uuid, status, signed_date)
     VALUES ($1,$2,$3)
     ON CONFLICT (uuid) DO UPDATE SET status = EXCLUDED.status, signed_date = EXCLUDED.signed_date
     RETURNING id`,
    [sigUuid, sig.status, sig.signedDate]
  );
  const signatureId = sigRows[0].id;

  const { rows: fileRows } = await client.query(
    `INSERT INTO file_resource (uuid, name, status, file_path)
     VALUES ($1,$2,'ready',$3)
     ON CONFLICT (uuid) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [fileUuid, `${doc.name}.pdf`, `/mock/contracts/${e.slug}-${idx}.pdf`]
  );
  const fileResourceId = fileRows[0].id;

  const dueDate = doc.status === 'expired' ? daysFromNow(-10) : daysFromNow(180);

  const { rows: docRows } = await client.query(
    `INSERT INTO document (uuid, name, status, due_date, signature_id, file_resource_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (uuid) DO UPDATE SET
       name = EXCLUDED.name, status = EXCLUDED.status, due_date = EXCLUDED.due_date,
       signature_id = EXCLUDED.signature_id, file_resource_id = EXCLUDED.file_resource_id
     RETURNING id`,
    [docUuid, doc.name, doc.status, dueDate, signatureId, fileResourceId]
  );
  const documentId = docRows[0].id;

  await client.query(
    `INSERT INTO enterprise_document (uuid, enterprise_id, document_id, doc_type, is_primary)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (uuid) DO UPDATE SET
       doc_type = EXCLUDED.doc_type, is_primary = EXCLUDED.is_primary`,
    [linkUuid, enterpriseId, documentId, doc.type, !!doc.primary]
  );
}

async function main() {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    let ent = 0;
    let docs = 0;
    for (const e of ENTERPRISES) {
      const enterpriseId = await upsertEnterprise(client, e);
      ent += 1;
      for (let i = 0; i < e.docs.length; i += 1) {
        await upsertDocumentChain(client, e, enterpriseId, e.docs[i], i);
        docs += 1;
      }
    }
    await client.query('COMMIT');
    console.log(`✔ Seed concluído: ${ent} empresas, ${docs} contratos/documentos.`);
    const owned = ENTERPRISES.filter((e) => e.ownerId === OWNER_PERSON_ID).map((e) => e.name);
    console.log(`  Empresas do person id ${OWNER_PERSON_ID}: ${owned.join(', ')}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('✖ Seed falhou (rollback):', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await db.pool.end();
  }
}

main();
