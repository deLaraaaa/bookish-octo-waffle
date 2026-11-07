import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const enterprise = require('../services/enterprise.js')
const audit = require('../services/audit.js')
const planilhas = require('../services/exports.js')

const GESTOR = { sub: 'p-1', email: 'gestor@catolicasc.org.br' }

const EMPRESA = {
  uuid: 'e-1',
  name: 'Kohlbach Motores',
  cnpj: '11222333000181',
  status: 'active',
  responsible_person: 'Marina Souza',
  contact_email: 'marina@kohlbach.com.br',
  phone_number: '4733728000',
  street: 'Rua Joinville',
  number: '3800',
  neighborhood: 'Vila Lalau',
  city: 'Jaraguá do Sul',
  state: 'SC',
  zip_code: '89256900',
  insert_date: '2026-01-10T12:00:00.000Z',
  institution: { name: 'Jaraguá do Sul', city: 'Jaraguá do Sul' },
  contracts: []
}

let registrar

beforeEach(() => {
  registrar = vi.spyOn(audit, 'record').mockResolvedValue(undefined)
  vi.spyOn(enterprise, 'list').mockResolvedValue({ items: [EMPRESA] })
  vi.spyOn(enterprise, 'listManage').mockResolvedValue({ items: [EMPRESA] })
})

async function linhasDe(workbook, aba) {
  const planilha = workbook.getWorksheet(aba)
  const linhas = []
  planilha.eachRow((row, i) => {
    if (i > 1) linhas.push(row.values.slice(1))
  })
  return { planilha, linhas }
}

describe('catalogWorkbook', () => {
  it('pede todas as empresas, sem paginar', async () => {
    await planilhas.catalogWorkbook(GESTOR, { search: 'kohl' })

    expect(enterprise.list).toHaveBeenCalledWith(GESTOR, expect.objectContaining({ all: true }))
  })

  it('repassa os filtros da tela', async () => {
    await planilhas.catalogWorkbook(GESTOR, { search: 'kohl', city: 'Joinville' })

    expect(enterprise.list).toHaveBeenCalledWith(
      GESTOR,
      expect.objectContaining({ search: 'kohl', city: 'Joinville' })
    )
  })

  it('gera a aba de empresas com cabeçalho', async () => {
    const { workbook } = await planilhas.catalogWorkbook(GESTOR)
    const aba = workbook.getWorksheet('Empresas parceiras')

    expect(aba).toBeDefined()
    expect(aba.getRow(1).values.slice(1)).toContain('Empresa')
    expect(aba.getRow(1).font.bold).toBe(true)
  })

  it('monta o endereço completo numa coluna', async () => {
    const { workbook } = await planilhas.catalogWorkbook(GESTOR)
    const { linhas } = await linhasDe(workbook, 'Empresas parceiras')

    expect(linhas[0]).toContain('Rua Joinville, 3800 - Vila Lalau - Jaraguá do Sul/SC')
  })

  it('não expõe CNPJ, e-mail nem contagem de contratos no catálogo', async () => {
    const { workbook } = await planilhas.catalogWorkbook(GESTOR)
    const cabecalho = workbook.getWorksheet('Empresas parceiras').getRow(1).values.join(' ')

    expect(cabecalho).not.toContain('CNPJ')
    expect(cabecalho).not.toContain('E-mail')
    expect(cabecalho).not.toContain('Contratos')
  })

  it('registra a exportação na auditoria', async () => {
    await planilhas.catalogWorkbook(GESTOR)

    expect(registrar).toHaveBeenCalledWith(
      GESTOR,
      'enterprise.export',
      expect.objectContaining({ entity: 'enterprise' })
    )
  })

  it('informa quantas linhas saíram', async () => {
    expect((await planilhas.catalogWorkbook(GESTOR)).total).toBe(1)
  })

  it('aguenta lista vazia', async () => {
    enterprise.list.mockResolvedValue({ items: [] })

    const { workbook, total } = await planilhas.catalogWorkbook(GESTOR)

    expect(total).toBe(0)
    expect(workbook.getWorksheet('Empresas parceiras')).toBeDefined()
  })
})

describe('manageWorkbook', () => {
  const COM_CONTRATOS = {
    ...EMPRESA,
    contracts: [
      { name: 'Convenio 2026', status: 'signed', signature_status: 'signed', due_date: '2027-01-10T00:00:00.000Z' },
      { name: 'Aditivo', status: 'pending', signature_status: 'waiting_signature', due_date: null },
      { name: 'Antigo', status: 'draft', signature_status: null, due_date: '2026-12-01T00:00:00.000Z' }
    ]
  }

  it('gera duas abas: empresas e contratos', async () => {
    const { workbook } = await planilhas.manageWorkbook(GESTOR)

    expect(workbook.getWorksheet('Empresas')).toBeDefined()
    expect(workbook.getWorksheet('Contratos')).toBeDefined()
  })

  it('conta contratos e pendências por empresa', async () => {
    enterprise.listManage.mockResolvedValue({ items: [COM_CONTRATOS] })

    const { workbook } = await planilhas.manageWorkbook(GESTOR)
    const { linhas } = await linhasDe(workbook, 'Empresas')

    expect(linhas[0]).toContain(3)
    expect(linhas[0]).toContain(2)
  })

  it('usa o vencimento mais próximo como alerta da empresa', async () => {
    enterprise.listManage.mockResolvedValue({ items: [COM_CONTRATOS] })

    const { workbook } = await planilhas.manageWorkbook(GESTOR)
    const aba = workbook.getWorksheet('Empresas')
    const proximo = aba.getRow(2).getCell('proximoVencimento').value

    expect(proximo).toBeInstanceOf(Date)
    expect(proximo.toISOString().slice(0, 10)).toBe('2026-12-01')
  })

  it('uma linha por contrato na segunda aba', async () => {
    enterprise.listManage.mockResolvedValue({ items: [COM_CONTRATOS] })

    const { workbook } = await planilhas.manageWorkbook(GESTOR)
    const { linhas } = await linhasDe(workbook, 'Contratos')

    expect(linhas).toHaveLength(3)
  })

  it('traduz as situações para português', async () => {
    enterprise.listManage.mockResolvedValue({ items: [COM_CONTRATOS] })

    const { workbook } = await planilhas.manageWorkbook(GESTOR)
    const { linhas } = await linhasDe(workbook, 'Contratos')

    expect(linhas[0]).toContain('Assinado')
    expect(linhas[1]).toContain('Aguardando assinatura')
  })

  it('descreve a pendência em linguagem de quem lê', async () => {
    expect(planilhas.pendenciaDe({ status: 'draft' })).toBe('Ainda não enviado para assinatura')
    expect(planilhas.pendenciaDe({ status: 'refused' })).toBe('Recusado, precisa ser refeito')
    expect(planilhas.pendenciaDe({ status: 'signed' })).toBe('')
  })

  it('a planilha de gestão inclui CNPJ e contato', async () => {
    const { workbook } = await planilhas.manageWorkbook(GESTOR)
    const cabecalho = workbook.getWorksheet('Empresas').getRow(1).values.join(' ')

    expect(cabecalho).toContain('CNPJ')
    expect(cabecalho).toContain('E-mail de contato')
  })

  it('registra o escopo de gestão na auditoria', async () => {
    await planilhas.manageWorkbook(GESTOR, { status: 'active' })

    expect(registrar).toHaveBeenCalledWith(
      GESTOR,
      'enterprise.export',
      expect.objectContaining({ detail: expect.objectContaining({ escopo: 'gestao' }) })
    )
  })
})

describe('nomeArquivo', () => {
  it('carimba a data no nome', () => {
    expect(planilhas.nomeArquivo('gestao-parcerias', new Date('2026-10-30T12:00:00Z')))
      .toBe('gestao-parcerias-2026-10-30.xlsx')
  })
})

describe('enderecoDe', () => {
  it('ignora partes ausentes sem deixar separador solto', () => {
    expect(planilhas.enderecoDe({ city: 'Joinville', state: 'SC' })).toBe('Joinville/SC')
    expect(planilhas.enderecoDe({})).toBe('')
  })
})
