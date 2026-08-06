// server/services/enterprise.js
'use strict';

const crud = require('../crud');

const SYSTEM_USER = 'system:app';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const onlyDigits = (v) => String(v || '').replace(/\D/g, '');

// Valida os dígitos verificadores do CNPJ (14 dígitos).
function isValidCnpj(rawCnpj) {
  const c = onlyDigits(rawCnpj);
  if (c.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(c)) return false; // rejeita todos iguais (00000000000000)

  const digit = (base) => {
    const weights = base === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < base; i += 1) sum += Number(c[i]) * weights[i];
    const mod = sum % 11;
    return mod < 2 ? 0 : 11 - mod;
  };

  return digit(12) === Number(c[12]) && digit(13) === Number(c[13]);
}

// Consulta um CNPJ na BrasilAPI (grátis, sem chave) e normaliza para os nossos
// nomes de campo. Proxy no backend evita CORS e centraliza o provedor.
async function lookupCnpj(user, rawCnpj) {
  const actor = user || SYSTEM_USER;
  const cnpj = onlyDigits(rawCnpj);
  if (!isValidCnpj(cnpj)) throw new HttpError(400, 'invalid_cnpj');

  let res;
  try {
    res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'bookish-octo-waffle/1.0', Accept: 'application/json' }
    });
  } catch (_e) {
    throw new HttpError(502, 'cnpj_provider_unavailable');
  }

  if (res.status === 404) throw new HttpError(404, 'cnpj_not_found');
  if (!res.ok) throw new HttpError(502, 'cnpj_provider_error');

  const d = await res.json();

  // Já existe uma empresa com esse CNPJ no sistema?
  const existing = await crud.read(
    'enterprise',
    { select: ['id'], where: { cnpj } },
    null,
    actor
  );

  return {
    cnpj,
    razao_social: d.razao_social || null,
    nome_fantasia: d.nome_fantasia || null,
    street: d.logradouro || null,
    number: d.numero || null,
    neighborhood: d.bairro || null,
    city: d.municipio || null,
    state: d.uf || null,
    zip_code: d.cep || null,
    phone_number: d.ddd_telefone_1 || null,
    already_registered: !!existing
  };
}

const CATALOG_FIELDS = [
  'uuid',
  'name',
  'responsible_person',
  'phone_number',
  'street',
  'number',
  'neighborhood',
  'city',
  'state',
  'zip_code',
  'status',
  'institution_id'
];

// Catálogo público de parcerias: lista as empresas ativas com o endereço e
// contato, já resolvendo a cidade a partir da instituição (institution) à qual
// cada empresa pertence. O front agrupa por essa cidade.
//
// opts.search: filtro por nome (ILIKE), feito no banco — não no frontend.
async function list(user, opts = {}) {
  const actor = user || SYSTEM_USER;

  const where = { active: true, status: 'active' };
  const search = typeof opts.search === 'string' ? opts.search.trim() : '';
  if (search) {
    where.name = { op: 'ilike', value: `%${search}%` };
  }

  const [institutions, enterprises] = await Promise.all([
    crud.list(
      'institution',
      { select: ['id', 'name', 'city'], where: { active: true } },
      null,
      actor
    ),
    crud.list(
      'enterprise',
      {
        select: CATALOG_FIELDS,
        where,
        orderBy: [{ column: 'name', direction: 'ASC' }]
      },
      null,
      actor
    )
  ]);

  const byId = new Map(institutions.map((i) => [i.id, i]));

  return enterprises.map((e) => {
    const inst = e.institution_id != null ? byId.get(e.institution_id) : null;
    const { institution_id, ...rest } = e;
    return {
      ...rest,
      // Cidade de agrupamento vem da instituição; cai para a cidade da própria
      // empresa quando ela não está vinculada a nenhuma instituição.
      city: inst?.city || rest.city || null,
      institution: inst ? { name: inst.name, city: inst.city } : null
    };
  });
}

// "Minhas empresas": somente as empresas criadas pelo usuário logado, incluindo
// seus contratos/documentos e o status de cada um (documento + assinatura).
async function listMine(user) {
  const actor = user || SYSTEM_USER;
  const personUuid = user && user.sub;
  if (!personUuid) return [];

  const person = await crud.read(
    'person',
    { select: ['id'], where: { uuid: personUuid } },
    null,
    actor
  );
  if (!person) return [];

  const enterprises = await crud.list(
    'enterprise',
    {
      select: ['id', ...CATALOG_FIELDS, 'cnpj', 'contact_email'],
      where: { active: true, created_by_person_id: person.id },
      orderBy: [{ column: 'name', direction: 'ASC' }]
    },
    null,
    actor
  );
  if (enterprises.length === 0) return [];

  const entIds = enterprises.map((e) => e.id);

  const links = await crud.list(
    'enterprise_document',
    {
      select: ['enterprise_id', 'document_id', 'doc_type', 'is_primary'],
      where: { active: true, enterprise_id: { op: 'in', value: entIds } }
    },
    null,
    actor
  );

  const docIds = links.map((l) => l.document_id);
  const documents = docIds.length
    ? await crud.list(
        'document',
        {
          select: ['id', 'uuid', 'name', 'status', 'due_date', 'signature_id'],
          where: { id: { op: 'in', value: docIds } }
        },
        null,
        actor
      )
    : [];

  const sigIds = documents.map((d) => d.signature_id).filter((v) => v != null);
  const signatures = sigIds.length
    ? await crud.list(
        'signature',
        {
          select: ['id', 'status', 'signed_date'],
          where: { id: { op: 'in', value: sigIds } }
        },
        null,
        actor
      )
    : [];

  const sigById = new Map(signatures.map((s) => [s.id, s]));
  const docById = new Map(documents.map((d) => [d.id, d]));

  const contractsByEnt = new Map();
  for (const l of links) {
    const doc = docById.get(l.document_id);
    if (!doc) continue;
    const sig = doc.signature_id != null ? sigById.get(doc.signature_id) : null;
    const arr = contractsByEnt.get(l.enterprise_id) || [];
    arr.push({
      uuid: doc.uuid,
      name: doc.name,
      status: doc.status,
      doc_type: l.doc_type,
      is_primary: l.is_primary,
      due_date: doc.due_date,
      signature_status: sig ? sig.status : null,
      signed_date: sig ? sig.signed_date : null
    });
    contractsByEnt.set(l.enterprise_id, arr);
  }

  return enterprises.map((e) => {
    const { id, institution_id, ...rest } = e;
    return { ...rest, contracts: contractsByEnt.get(id) || [] };
  });
}

// Cadastro de empresa pelo usuário ("Enviar para análise"). Nasce com
// status 'inactive' (aguardando análise da gestão) e vinculada ao usuário.
// Se vier um arquivo, cria file_resource + document + enterprise_document.
async function create(user, body, file) {
  const actor = user || SYSTEM_USER;
  const personUuid = user && user.sub;
  if (!personUuid) throw new HttpError(401, 'unauthorized');

  const person = await crud.read(
    'person',
    { select: ['id', 'institution_id'], where: { uuid: personUuid } },
    null,
    actor
  );
  if (!person) throw new HttpError(404, 'person_not_found');

  const name = (body.name || '').trim();
  if (!name) throw new HttpError(400, 'name_required');

  // Validação de CNPJ + unicidade (quando informado).
  const cnpj = body.cnpj ? onlyDigits(body.cnpj) : null;
  if (cnpj) {
    if (!isValidCnpj(cnpj)) throw new HttpError(400, 'invalid_cnpj');
    const existing = await crud.read(
      'enterprise',
      { select: ['id'], where: { cnpj } },
      null,
      actor
    );
    if (existing) throw new HttpError(409, 'cnpj_already_exists');
  }

  let enterprise;
  try {
    enterprise = await crud.create(
      'enterprise',
      {
        name,
        cnpj,
        responsible_person: (body.contact_name || '').trim() || null,
        contact_email: (body.contact_email || '').trim() || null,
        phone_number: (body.phone_number || '').trim() || null,
        street: (body.street || '').trim() || null,
        number: (body.number || '').trim() || null,
        neighborhood: (body.neighborhood || '').trim() || null,
        city: (body.city || '').trim() || null,
        state: (body.state || '').trim() || null,
        zip_code: (body.zip_code || '').trim() || null,
        status: 'inactive',
        active: true,
        institution_id: person.institution_id,
        created_by_person_id: person.id
      },
      { returning: ['id', 'uuid'] },
      actor
    );
  } catch (err) {
    // Corrida: dois cadastros simultâneos do mesmo CNPJ. O índice único barra
    // o segundo (Postgres 23505) — devolve o mesmo 409 da checagem prévia.
    if (err && err.code === '23505') throw new HttpError(409, 'cnpj_already_exists');
    throw err;
  }

  if (file && file.buffer) {
    const fileResource = await crud.create(
      'file_resource',
      { name: file.originalname || 'documento', status: 'uploaded', content: file.buffer },
      { returning: ['id'] },
      actor
    );
    const document = await crud.create(
      'document',
      {
        name: file.originalname || 'Documento da empresa',
        status: 'draft',
        file_resource_id: fileResource.id
      },
      { returning: ['id'] },
      actor
    );
    await crud.create(
      'enterprise_document',
      {
        enterprise_id: enterprise.id,
        document_id: document.id,
        doc_type: 'attachment',
        is_primary: true
      },
      { returning: false },
      actor
    );
  }

  return { uuid: enterprise.uuid };
}

module.exports = { list, listMine, lookupCnpj, create };
