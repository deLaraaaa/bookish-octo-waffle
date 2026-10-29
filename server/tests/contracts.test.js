import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const storage = require('../services/storage.js')
const contracts = require('../services/contracts.js')

const ATOR = 'p-1'

let leitura
let listas
let read
let list
let create
let update
let listarContratos

beforeEach(() => {
  leitura = {
    file_resource: null,
    document: null,
    enterprise: null,
    enterprise_document: null
  }
  listas = { enterprise_document: [], document: [], file_resource: [] }

  read = vi.spyOn(crud, 'read').mockImplementation(async (tabela) => leitura[tabela] || null)
  list = vi.spyOn(crud, 'list').mockImplementation(async (tabela) => listas[tabela] || [])
  create = vi.spyOn(crud, 'create').mockImplementation(async (tabela) => {
    if (tabela === 'signature') return { id: 50 }
    if (tabela === 'file_resource') return { id: 60 }
    if (tabela === 'document') return { id: 70, uuid: 'd-novo', status: 'draft' }
    return { rowCount: 1 }
  })
  update = vi.spyOn(crud, 'update').mockResolvedValue([{ uuid: 'd-1', status: 'signed' }])
  listarContratos = vi.spyOn(storage, 'listContracts').mockResolvedValue([])
})

const criacaoDe = (tabela) => create.mock.calls.find((c) => c[0] === tabela)
const atualizacaoDe = (tabela) => update.mock.calls.find((c) => c[0] === tabela)

describe('ensureDocument', () => {
  it('reaproveita o documento já existente para o arquivo', async () => {
    leitura.file_resource = { id: 10 }
    leitura.document = { id: 11, uuid: 'd-1', status: 'pending' }

    expect(await contracts.ensureDocument(ATOR, 'item-1')).toEqual({
      id: 11,
      uuid: 'd-1',
      status: 'pending'
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('procura o arquivo pelo caminho com prefixo do OneDrive', async () => {
    leitura.file_resource = { id: 10 }
    leitura.document = { id: 11, uuid: 'd-1', status: 'draft' }

    await contracts.ensureDocument(ATOR, 'item-1')

    expect(read.mock.calls[0][1].where).toEqual({ active: true, file_path: 'onedrive:item-1' })
  })

  it('cria documento e assinatura quando o arquivo existe mas o documento não', async () => {
    leitura.file_resource = { id: 10 }
    leitura.document = null

    const doc = await contracts.ensureDocument(ATOR, 'item-1', 'Contrato ACME')

    expect(criacaoDe('file_resource')).toBeUndefined()
    expect(criacaoDe('signature')[1]).toEqual({ status: 'pending_submission' })
    expect(criacaoDe('document')[1]).toMatchObject({
      name: 'Contrato ACME',
      status: 'draft',
      file_resource_id: 10,
      signature_id: 50
    })
    expect(doc.uuid).toBe('d-novo')
  })

  it('cria arquivo, assinatura e documento quando nada existe', async () => {
    await contracts.ensureDocument(ATOR, 'item-9', 'Contrato novo')

    expect(criacaoDe('file_resource')[1]).toEqual({
      name: 'Contrato novo',
      status: 'uploaded',
      file_path: 'onedrive:item-9'
    })
    expect(criacaoDe('document')[1].file_resource_id).toBe(60)
  })

  it('usa rótulos padrão quando o nome não é informado', async () => {
    await contracts.ensureDocument(ATOR, 'item-9')

    expect(criacaoDe('file_resource')[1].name).toBe('contrato')
    expect(criacaoDe('document')[1].name).toBe('Contrato')
  })
})

describe('syncSignature', () => {
  it('ignora documento inexistente', async () => {
    leitura.document = null

    await contracts.syncSignature(ATOR, 'd-1')

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('cria a assinatura e vincula ao documento quando ainda não existe', async () => {
    leitura.document = { id: 11, status: 'pending', signature_id: null }

    await contracts.syncSignature(ATOR, 'd-1')

    expect(criacaoDe('signature')[1]).toEqual({ status: 'waiting_signature', signed_date: null })
    expect(atualizacaoDe('document')[1]).toEqual({ signature_id: 50 })
    expect(atualizacaoDe('document')[2].where).toEqual({ id: 11 })
  })

  it('atualiza a assinatura existente em vez de criar outra', async () => {
    leitura.document = { id: 11, status: 'pending', signature_id: 99 }

    await contracts.syncSignature(ATOR, 'd-1')

    expect(create).not.toHaveBeenCalled()
    expect(atualizacaoDe('signature')[2].where).toEqual({ id: 99 })
  })

  it.each([
    ['signed', 'signed'],
    ['pending', 'waiting_signature'],
    ['refused', 'expired'],
    ['expired', 'expired'],
    ['draft', 'pending_submission'],
    ['desconhecido', 'pending_submission']
  ])('documento %s espelha assinatura %s', async (docStatus, esperado) => {
    leitura.document = { id: 11, status: docStatus, signature_id: 99 }

    await contracts.syncSignature(ATOR, 'd-1')

    expect(atualizacaoDe('signature')[1].status).toBe(esperado)
  })

  it('arquivar não mexe na assinatura, porque não diz se foi assinado', async () => {
    leitura.document = { id: 11, status: 'archived', signature_id: 99 }

    await contracts.syncSignature(ATOR, 'd-1')

    expect(update).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('carimba a data só quando a assinatura fica assinada', async () => {
    leitura.document = { id: 11, status: 'signed', signature_id: 99 }
    await contracts.syncSignature(ATOR, 'd-1')
    expect(atualizacaoDe('signature')[1].signed_date).toBeInstanceOf(Date)

    update.mockClear()
    leitura.document = { id: 11, status: 'pending', signature_id: 99 }
    await contracts.syncSignature(ATOR, 'd-1')
    expect(atualizacaoDe('signature')[1].signed_date).toBeNull()
  })
})

describe('linkToEnterprise', () => {
  beforeEach(() => {
    leitura.enterprise = { id: 5 }
    leitura.file_resource = { id: 10 }
    leitura.document = { id: 11, uuid: 'd-1', status: 'draft' }
  })

  it.each([
    ['sem empresa', { itemId: 'item-1' }],
    ['sem arquivo', { enterpriseUuid: 'e-1' }],
    ['sem nada', {}]
  ])('recusa vínculo %s', async (_rotulo, entrada) => {
    await expect(contracts.linkToEnterprise(ATOR, entrada)).rejects.toMatchObject({
      status: 400,
      code: 'enterpriseUuid_and_itemId_required'
    })
  })

  it('recusa empresa inexistente', async () => {
    leitura.enterprise = null

    await expect(
      contracts.linkToEnterprise(ATOR, { enterpriseUuid: 'e-1', itemId: 'item-1' })
    ).rejects.toMatchObject({ status: 404, code: 'enterprise_not_found' })
  })

  it('recusa contrato já vinculado a alguma empresa', async () => {
    leitura.enterprise_document = { id: 77 }

    await expect(
      contracts.linkToEnterprise(ATOR, { enterpriseUuid: 'e-1', itemId: 'item-1' })
    ).rejects.toMatchObject({ status: 409, code: 'contract_already_linked' })
    expect(criacaoDe('enterprise_document')).toBeUndefined()
  })

  it('vincula como contrato, não como anexo principal', async () => {
    const resultado = await contracts.linkToEnterprise(ATOR, {
      enterpriseUuid: 'e-1',
      itemId: 'item-1',
      name: 'Contrato'
    })

    expect(criacaoDe('enterprise_document')[1]).toEqual({
      enterprise_id: 5,
      document_id: 11,
      doc_type: 'contract',
      is_primary: false
    })
    expect(resultado).toEqual({ document_uuid: 'd-1' })
  })
})

describe('setStatusByItem', () => {
  beforeEach(() => {
    leitura.file_resource = { id: 10 }
    leitura.document = { id: 11, uuid: 'd-1', status: 'draft', signature_id: 99 }
  })

  it('exige o arquivo', async () => {
    await expect(contracts.setStatusByItem(ATOR, { status: 'signed' })).rejects.toMatchObject({
      status: 400,
      code: 'itemId_required'
    })
  })

  it('atualiza o documento e devolve o novo status', async () => {
    update.mockResolvedValue([{ uuid: 'd-1', status: 'pending' }])

    const linha = await contracts.setStatusByItem(ATOR, { itemId: 'item-1', status: 'pending' })

    expect(atualizacaoDe('document')[1]).toEqual({ status: 'pending' })
    expect(atualizacaoDe('document')[2].where).toEqual({ uuid: 'd-1' })
    expect(linha).toEqual({ uuid: 'd-1', status: 'pending' })
  })

  it('recusa transição ilegal antes de tocar no banco', async () => {
    leitura.document = { id: 11, uuid: 'd-1', status: 'signed', signature_id: 99 }

    await expect(
      contracts.setStatusByItem(ATOR, { itemId: 'item-1', status: 'draft' })
    ).rejects.toMatchObject({ code: 'invalid_transition', status: 409 })

    expect(atualizacaoDe('document')).toBeUndefined()
  })

  it('mantém a assinatura coerente com o novo status do documento', async () => {
    leitura.document = { id: 11, uuid: 'd-1', status: 'pending', signature_id: 99 }

    await contracts.setStatusByItem(ATOR, { itemId: 'item-1', status: 'signed' })

    expect(atualizacaoDe('signature')[1].status).toBe('waiting_signature')
  })
})

describe('listUnlinked', () => {
  const arquivo = (id, name) => ({ id, name, size: 100, modified: '2026-10-01' })

  it('agrupa docx e pdf de mesmo nome em um item só', async () => {
    listarContratos.mockResolvedValue([
      arquivo('i-1', 'Contrato ACME.docx'),
      arquivo('i-2', 'Contrato ACME.pdf')
    ])

    const livres = await contracts.listUnlinked('tok', ATOR)

    expect(livres).toHaveLength(1)
  })

  it('prefere o PDF como representante do grupo', async () => {
    listarContratos.mockResolvedValue([
      arquivo('i-1', 'Contrato ACME.docx'),
      arquivo('i-2', 'Contrato ACME.pdf')
    ])

    expect((await contracts.listUnlinked('tok', ATOR))[0].itemId).toBe('i-2')
  })

  it('sem PDF, usa o primeiro arquivo do grupo', async () => {
    listarContratos.mockResolvedValue([arquivo('i-1', 'Contrato ACME.docx')])

    expect((await contracts.listUnlinked('tok', ATOR))[0].itemId).toBe('i-1')
  })

  it('esconde o grupo inteiro quando qualquer arquivo dele já está vinculado', async () => {
    listarContratos.mockResolvedValue([
      arquivo('i-1', 'Contrato ACME.docx'),
      arquivo('i-2', 'Contrato ACME.pdf'),
      arquivo('i-3', 'Outro.pdf')
    ])
    listas.enterprise_document = [{ document_id: 1 }]
    listas.document = [{ file_resource_id: 2 }]
    listas.file_resource = [{ file_path: 'onedrive:i-1' }]

    const livres = await contracts.listUnlinked('tok', ATOR)

    expect(livres.map((f) => f.name)).toEqual(['Outro.pdf'])
  })

  it('ignora caminho de arquivo que não é do OneDrive', async () => {
    listarContratos.mockResolvedValue([arquivo('i-1', 'Contrato.pdf')])
    listas.enterprise_document = [{ document_id: 1 }]
    listas.document = [{ file_resource_id: 2 }]
    listas.file_resource = [{ file_path: '/disco/local/contrato.pdf' }]

    expect(await contracts.listUnlinked('tok', ATOR)).toHaveLength(1)
  })

  it('arquivo sem caminho registrado não é tratado como vinculado', async () => {
    listarContratos.mockResolvedValue([arquivo('i-1', 'Contrato.pdf')])
    listas.enterprise_document = [{ document_id: 1 }]
    listas.document = [{ file_resource_id: 2 }]
    listas.file_resource = [{ file_path: null }]

    expect(await contracts.listUnlinked('tok', ATOR)).toHaveLength(1)
  })

  it('não consulta documentos quando não há vínculo nenhum', async () => {
    listarContratos.mockResolvedValue([arquivo('i-1', 'Contrato.pdf')])

    await contracts.listUnlinked('tok', ATOR)

    expect(list.mock.calls.some((c) => c[0] === 'document')).toBe(false)
  })

  it('não consulta arquivos quando os documentos não apontam para nenhum', async () => {
    listarContratos.mockResolvedValue([arquivo('i-1', 'Contrato.pdf')])
    listas.enterprise_document = [{ document_id: 1 }]
    listas.document = [{ file_resource_id: null }]

    await contracts.listUnlinked('tok', ATOR)

    expect(list.mock.calls.some((c) => c[0] === 'file_resource')).toBe(false)
  })
})

describe('listGenerated', () => {
  it('enriquece o arquivo do OneDrive com o documento correspondente', async () => {
    listarContratos.mockResolvedValue([
      { id: 'i-1', name: 'Contrato.pdf', size: 10, modified: '2026-10-01' }
    ])
    listas.file_resource = [{ id: 2, file_path: 'onedrive:i-1' }]
    listas.document = [{ uuid: 'd-1', status: 'signed', file_resource_id: 2 }]

    expect(await contracts.listGenerated('tok', ATOR)).toEqual([
      {
        id: 'i-1',
        name: 'Contrato.pdf',
        size: 10,
        modified: '2026-10-01',
        document_uuid: 'd-1',
        status: 'signed'
      }
    ])
  })

  it('arquivo sem documento aparece com status nulo', async () => {
    listarContratos.mockResolvedValue([
      { id: 'i-9', name: 'Solto.pdf', size: 10, modified: '2026-10-01' }
    ])

    const [item] = await contracts.listGenerated('tok', ATOR)

    expect(item.document_uuid).toBeNull()
    expect(item.status).toBeNull()
  })

  it('busca apenas arquivos com o prefixo do OneDrive', async () => {
    await contracts.listGenerated('tok', ATOR)

    const opcoes = list.mock.calls.find((c) => c[0] === 'file_resource')[1]
    expect(opcoes.where).toEqual({
      active: true,
      file_path: { op: 'ilike', value: 'onedrive:%' }
    })
  })

  it('não consulta documentos quando não há arquivo registrado', async () => {
    listarContratos.mockResolvedValue([{ id: 'i-1', name: 'x.pdf' }])

    await contracts.listGenerated('tok', ATOR)

    expect(list.mock.calls.some((c) => c[0] === 'document')).toBe(false)
  })
})
