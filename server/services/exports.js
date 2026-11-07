'use strict';

const ExcelJS = require('exceljs');
const enterprise = require('./enterprise');
const audit = require('./audit');

const ENTERPRISE_STATUS_PT = {
  active: 'Ativa',
  pending: 'Pendente',
  suspended: 'Suspensa',
  inactive: 'Inativa'
};

const DOC_STATUS_PT = {
  draft: 'Rascunho',
  pending: 'Aguardando assinatura',
  signed: 'Assinado',
  refused: 'Recusado',
  expired: 'Expirado',
  archived: 'Arquivado'
};

const SIGNATURE_STATUS_PT = {
  pending_submission: 'Aguardando envio',
  waiting_signature: 'Aguardando assinatura',
  signed: 'Assinado',
  expired: 'Expirada'
};

const traduz = (mapa, valor) => (valor ? mapa[valor] || valor : '');

function enderecoDe(e) {
  const rua = [e.street, e.number].filter(Boolean).join(', ');
  const local = [e.city, e.state].filter(Boolean).join('/');
  return [rua, e.neighborhood, local].filter(Boolean).join(' - ');
}

function dataOuVazio(valor) {
  if (!valor) return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

function novaPlanilha() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Parcerias Catolica SC';
  wb.created = new Date();
  return wb;
}

function montarAba(wb, titulo, colunas, linhas) {
  const aba = wb.addWorksheet(titulo, {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  aba.columns = colunas.map((c) => ({ header: c.header, key: c.key, width: c.width || 22 }));

  aba.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  aba.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF911739' }
  };
  aba.getRow(1).alignment = { vertical: 'middle' };
  aba.getRow(1).height = 22;

  for (const linha of linhas) aba.addRow(linha);

  for (const coluna of colunas) {
    if (coluna.type === 'date') {
      aba.getColumn(coluna.key).numFmt = 'dd/mm/yyyy';
    }
    if (coluna.type === 'text') {
      aba.getColumn(coluna.key).alignment = { horizontal: 'left' };
    }
  }

  if (linhas.length) {
    aba.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: colunas.length }
    };
  }

  return aba;
}

const COLUNAS_CATALOGO = [
  { header: 'Empresa', key: 'nome', width: 38 },
  { header: 'Responsável', key: 'responsavel', width: 26 },
  { header: 'Telefone', key: 'telefone', width: 18, type: 'text' },
  { header: 'Endereço', key: 'endereco', width: 46 },
  { header: 'Cidade', key: 'cidade', width: 20 },
  { header: 'Estado', key: 'estado', width: 10 },
  { header: 'CEP', key: 'cep', width: 14, type: 'text' },
  { header: 'Unidade', key: 'unidade', width: 20 }
];

async function catalogWorkbook(user, opts = {}) {
  const { items } = await enterprise.list(user, { ...opts, all: true });

  const linhas = items.map((e) => ({
    nome: e.name || '',
    responsavel: e.responsible_person || '',
    telefone: e.phone_number || '',
    endereco: enderecoDe(e),
    cidade: e.city || '',
    estado: e.state || '',
    cep: e.zip_code || '',
    unidade: (e.institution && e.institution.name) || ''
  }));

  const wb = novaPlanilha();
  montarAba(wb, 'Empresas parceiras', COLUNAS_CATALOGO, linhas);

  await audit.record(user, 'enterprise.export', {
    entity: 'enterprise',
    detail: { escopo: 'catalogo', linhas: linhas.length, filtros: opts.search || opts.city || null }
  });

  return { workbook: wb, total: linhas.length };
}

const COLUNAS_GESTAO = [
  { header: 'Empresa', key: 'nome', width: 38 },
  { header: 'CNPJ', key: 'cnpj', width: 20, type: 'text' },
  { header: 'Situação', key: 'situacao', width: 14 },
  { header: 'Unidade', key: 'unidade', width: 20 },
  { header: 'Cidade', key: 'cidade', width: 20 },
  { header: 'Responsável', key: 'responsavel', width: 24 },
  { header: 'E-mail de contato', key: 'email', width: 30 },
  { header: 'Telefone', key: 'telefone', width: 18, type: 'text' },
  { header: 'Cadastrada em', key: 'cadastro', width: 16, type: 'date' },
  { header: 'Contratos', key: 'totalContratos', width: 12 },
  { header: 'Pendentes', key: 'pendentes', width: 12 },
  { header: 'Vencimento mais próximo', key: 'proximoVencimento', width: 22, type: 'date' }
];

const COLUNAS_CONTRATOS = [
  { header: 'Empresa', key: 'empresa', width: 38 },
  { header: 'Contrato', key: 'contrato', width: 38 },
  { header: 'Situação', key: 'situacao', width: 22 },
  { header: 'Assinatura', key: 'assinatura', width: 22 },
  { header: 'Vencimento', key: 'vencimento', width: 16, type: 'date' },
  { header: 'Pendência', key: 'pendencia', width: 28 }
];

const PENDENTE = new Set(['draft', 'pending', 'refused']);

function pendenciaDe(c) {
  if (c.status === 'draft') return 'Ainda não enviado para assinatura';
  if (c.status === 'pending') return 'Aguardando assinatura';
  if (c.status === 'refused') return 'Recusado, precisa ser refeito';
  if (c.status === 'expired') return 'Vigência encerrada';
  return '';
}

async function manageWorkbook(user, opts = {}) {
  const { items } = await enterprise.listManage(user, { ...opts, all: true });

  const empresas = [];
  const contratos = [];

  for (const e of items) {
    const docs = e.contracts || [];
    const vencimentos = docs
      .map((c) => dataOuVazio(c.due_date))
      .filter(Boolean)
      .sort((a, b) => a - b);

    empresas.push({
      nome: e.name || '',
      cnpj: e.cnpj || '',
      situacao: traduz(ENTERPRISE_STATUS_PT, e.status),
      unidade: (e.institution && e.institution.name) || '',
      cidade: e.city || '',
      responsavel: e.responsible_person || '',
      email: e.contact_email || '',
      telefone: e.phone_number || '',
      cadastro: dataOuVazio(e.insert_date),
      totalContratos: docs.length,
      pendentes: docs.filter((c) => PENDENTE.has(c.status)).length,
      proximoVencimento: vencimentos[0] || null
    });

    for (const c of docs) {
      contratos.push({
        empresa: e.name || '',
        contrato: c.name || '',
        situacao: traduz(DOC_STATUS_PT, c.status),
        assinatura: traduz(SIGNATURE_STATUS_PT, c.signature_status),
        vencimento: dataOuVazio(c.due_date),
        pendencia: pendenciaDe(c)
      });
    }
  }

  const wb = novaPlanilha();
  montarAba(wb, 'Empresas', COLUNAS_GESTAO, empresas);
  montarAba(wb, 'Contratos', COLUNAS_CONTRATOS, contratos);

  await audit.record(user, 'enterprise.export', {
    entity: 'enterprise',
    detail: {
      escopo: 'gestao',
      empresas: empresas.length,
      contratos: contratos.length,
      filtros: { search: opts.search || null, city: opts.city || null, status: opts.status || null }
    }
  });

  return { workbook: wb, total: empresas.length };
}

function nomeArquivo(prefixo, agora = new Date()) {
  const d = agora.toISOString().slice(0, 10);
  return `${prefixo}-${d}.xlsx`;
}

module.exports = {
  catalogWorkbook,
  manageWorkbook,
  nomeArquivo,
  enderecoDe,
  pendenciaDe,
  COLUNAS_CATALOGO,
  COLUNAS_GESTAO,
  COLUNAS_CONTRATOS
};
