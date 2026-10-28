import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const audit = require('../services/audit.js')
const enterprise = require('../services/enterprise.js')

const USUARIO = { sub: 'p-1', email: 'ra.cardoso@catolicasc.edu.br' }
const SYSTEM_USER = 'system:app'
const CNPJ_VALIDO = '11222333000181'

let banco
let leitura
let list
let read
let create
let update
let registrar
let buscarNaWeb

beforeEach(() => {
  banco = {
    institution: [],
    enterprise: [],
    enterprise_document: [],
    document: [],
    file_resource: [],
    signature: []
  }
  leitura = { enterprise: null, person: null }

  list = vi.spyOn(crud, 'list').mockImplementation(async (tabela) => banco[tabela] || [])
  read = vi.spyOn(crud, 'read').mockImplementation(async (tabela) => leitura[tabela] || null)
  create = vi.spyOn(crud, 'create').mockImplementation(async (tabela) => {
    if (tabela === 'enterprise') return { id: 100, uuid: 'e-uuid' }
    if (tabela === 'file_resource') return { id: 200 }
    if (tabela === 'document') return { id: 300 }
    return { rowCount: 1 }
  })
  update = vi.spyOn(crud, 'update').mockResolvedValue([{ uuid: 'e-uuid', status: 'active' }])
  registrar = vi.spyOn(audit, 'record').mockResolvedValue(undefined)
  buscarNaWeb = vi.fn()
  vi.stubGlobal('fetch', buscarNaWeb)
})

const consultaDe = (tabela) => list.mock.calls.find((c) => c[0] === tabela)[1]
const criacaoDe = (tabela) => create.mock.calls.find((c) => c[0] === tabela)

function cadastrarEmpresa(id, nome, extras = {}) {
  banco.enterprise.push({
    id,
    uuid: `e-${id}`,
    name: nome,
    responsible_person: 'Responsável',
    phone_number: '(47) 3000-0000',
    street: 'Rua X',
    number: '1',
    neighborhood: 'Centro',
    city: 'Jaraguá do Sul',
    state: 'SC',
    zip_code: '89250-000',
    status: 'active',
    institution_id: null,
    cnpj: null,
    contact_email: null,
    ...extras
  })
}

function vincularContrato(enterpriseId, opcoes = {}) {
  const docId = banco.document.length + 1
  const sigId = banco.signature.length + 1
  const {
    docType = 'contract',
    docStatus = 'signed',
    assinatura = 'signed',
    dueDate = null,
    filePath = null
  } = opcoes

  banco.enterprise_document.push({
    enterprise_id: enterpriseId,
    document_id: docId,
    doc_type: docType,
    is_primary: true
  })
  banco.signature.push({ id: sigId, status: assinatura, signed_date: null })
  banco.document.push({
    id: docId,
    uuid: `d-${docId}`,
    name: 'Contrato',
    status: docStatus,
    due_date: dueDate,
    signature_id: sigId,
    file_resource_id: filePath ? docId : null
  })
  if (filePath) banco.file_resource.push({ id: docId, file_path: filePath })
}

describe('lookupCnpj', () => {
  it.each([
    ['curto demais', '123'],
    ['dígito verificador errado', '11222333000182'],
    ['todos os dígitos iguais', '11111111111111'],
    ['vazio', '']
  ])('recusa CNPJ %s sem consultar o provedor', async (_rotulo, cnpj) => {
    await expect(enterprise.lookupCnpj(USUARIO, cnpj)).rejects.toMatchObject({
      status: 400,
      message: 'invalid_cnpj'
    })
    expect(buscarNaWeb).not.toHaveBeenCalled()
  })

  it('aceita CNPJ com pontuação e consulta só os dígitos', async () => {
    buscarNaWeb.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

    await enterprise.lookupCnpj(USUARIO, '11.222.333/0001-81')

    expect(buscarNaWeb.mock.calls[0][0]).toContain(CNPJ_VALIDO)
  })

  it('traduz indisponibilidade de rede em erro de provedor', async () => {
    buscarNaWeb.mockRejectedValue(new Error('ENOTFOUND'))

    await expect(enterprise.lookupCnpj(USUARIO, CNPJ_VALIDO)).rejects.toMatchObject({
      status: 502,
      message: 'cnpj_provider_unavailable'
    })
  })

  it('distingue CNPJ inexistente de falha do provedor', async () => {
    buscarNaWeb.mockResolvedValue({ ok: false, status: 404 })
    await expect(enterprise.lookupCnpj(USUARIO, CNPJ_VALIDO)).rejects.toMatchObject({
      status: 404,
      message: 'cnpj_not_found'
    })

    buscarNaWeb.mockResolvedValue({ ok: false, status: 500 })
    await expect(enterprise.lookupCnpj(USUARIO, CNPJ_VALIDO)).rejects.toMatchObject({
      status: 502,
      message: 'cnpj_provider_error'
    })
  })

  it('mapeia a resposta da BrasilAPI para o formato do cadastro', async () => {
    buscarNaWeb.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        razao_social: 'KOHLBACH S.A.',
        nome_fantasia: 'Kohlbach',
        logradouro: 'Rua Joinville',
        numero: '3800',
        bairro: 'Vila Lalau',
        municipio: 'JARAGUA DO SUL',
        uf: 'SC',
        cep: '89256900',
        ddd_telefone_1: '4733728000'
      })
    })

    expect(await enterprise.lookupCnpj(USUARIO, CNPJ_VALIDO)).toEqual({
      cnpj: CNPJ_VALIDO,
      razao_social: 'KOHLBACH S.A.',
      nome_fantasia: 'Kohlbach',
      street: 'Rua Joinville',
      number: '3800',
      neighborhood: 'Vila Lalau',
      city: 'JARAGUA DO SUL',
      state: 'SC',
      zip_code: '89256900',
      phone_number: '4733728000',
      already_registered: false
    })
  })

  it('campo ausente na resposta vira null', async () => {
    buscarNaWeb.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

    const dados = await enterprise.lookupCnpj(USUARIO, CNPJ_VALIDO)

    expect(dados.razao_social).toBeNull()
    expect(dados.city).toBeNull()
  })

  it('avisa quando o CNPJ já está cadastrado', async () => {
    buscarNaWeb.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    leitura.enterprise = { id: 9 }

    expect((await enterprise.lookupCnpj(USUARIO, CNPJ_VALIDO)).already_registered).toBe(true)
  })
})

describe('list', () => {
  it('mostra apenas empresas com contrato vigente', async () => {
    cadastrarEmpresa(1, 'Com contrato')
    cadastrarEmpresa(2, 'Sem contrato')
    vincularContrato(1)

    const { items } = await enterprise.list(USUARIO)

    expect(items.map((e) => e.name)).toEqual(['Com contrato'])
  })

  it.each([
    ['documento que não é contrato', { docType: 'attachment' }],
    ['contrato não assinado', { docStatus: 'draft' }],
    ['assinatura pendente', { assinatura: 'waiting_signature' }],
    ['contrato vencido', { dueDate: new Date(Date.now() - 86400000) }]
  ])('não mostra empresa com %s', async (_rotulo, opcoes) => {
    cadastrarEmpresa(1, 'Empresa')
    vincularContrato(1, opcoes)

    expect((await enterprise.list(USUARIO)).items).toEqual([])
  })

  it('contrato sem data de vencimento é considerado vigente', async () => {
    cadastrarEmpresa(1, 'Empresa')
    vincularContrato(1, { dueDate: null })

    expect((await enterprise.list(USUARIO)).items).toHaveLength(1)
  })

  it('contrato com vencimento futuro é vigente', async () => {
    cadastrarEmpresa(1, 'Empresa')
    vincularContrato(1, { dueDate: new Date(Date.now() + 86400000) })

    expect((await enterprise.list(USUARIO)).items).toHaveLength(1)
  })

  it('busca por nome usa comparação sem diferenciar maiúsculas', async () => {
    await enterprise.list(USUARIO, { search: '  kohlbach  ' })

    expect(consultaDe('enterprise').where.name).toEqual({ op: 'ilike', value: '%kohlbach%' })
  })

  it('traz só empresas ativas e aprovadas', async () => {
    await enterprise.list(USUARIO)

    expect(consultaDe('enterprise').where).toMatchObject({ active: true, status: 'active' })
  })

  it('filtra cidade ignorando acento e caixa', async () => {
    cadastrarEmpresa(1, 'Daqui', { city: 'Jaraguá do Sul' })
    cadastrarEmpresa(2, 'De fora', { city: 'Joinville' })
    vincularContrato(1)
    vincularContrato(2)

    const { items } = await enterprise.list(USUARIO, { city: 'JARAGUA DO SUL' })

    expect(items.map((e) => e.name)).toEqual(['Daqui'])
  })

  it('a cidade da instituição tem precedência sobre a da empresa', async () => {
    banco.institution.push({ id: 7, name: 'Campus Joinville', city: 'Joinville' })
    cadastrarEmpresa(1, 'Empresa', { city: 'Jaraguá do Sul', institution_id: 7 })
    vincularContrato(1)

    const { items } = await enterprise.list(USUARIO)

    expect(items[0].city).toBe('Joinville')
    expect(items[0].institution).toEqual({ name: 'Campus Joinville', city: 'Joinville' })
  })

  it('empresa sem instituição não quebra o catálogo', async () => {
    cadastrarEmpresa(1, 'Empresa', { institution_id: null })
    vincularContrato(1)

    const { items } = await enterprise.list(USUARIO)

    expect(items[0].institution).toBeNull()
    expect(items[0].city).toBe('Jaraguá do Sul')
  })

  it('não expõe identificadores internos nem o status', async () => {
    cadastrarEmpresa(1, 'Empresa')
    vincularContrato(1)

    const [item] = (await enterprise.list(USUARIO)).items

    expect(item).not.toHaveProperty('id')
    expect(item).not.toHaveProperty('institution_id')
    expect(item).not.toHaveProperty('status')
    expect(item.uuid).toBe('e-1')
  })

  it('pagina em dez por página e sinaliza se há mais', async () => {
    for (let i = 1; i <= 11; i++) {
      cadastrarEmpresa(i, `Empresa ${i}`)
      vincularContrato(i)
    }

    const primeira = await enterprise.list(USUARIO)
    expect(primeira.items).toHaveLength(10)
    expect(primeira.pageSize).toBe(10)
    expect(primeira.hasMore).toBe(true)

    const segunda = await enterprise.list(USUARIO, { page: 2 })
    expect(segunda.items).toHaveLength(1)
    expect(segunda.hasMore).toBe(false)
  })

  it.each([['zero', 0], ['negativa', -3], ['texto', 'abc']])(
    'trata página %s como a primeira',
    async (_rotulo, page) => {
      expect((await enterprise.list(USUARIO, { page })).page).toBe(1)
    }
  )

  it('sem usuário, consulta como o usuário de sistema', async () => {
    await enterprise.list(null)
    expect(list.mock.calls[0][3]).toBe(SYSTEM_USER)
  })
})

describe('contratos vinculados', () => {
  it('extrai o itemId do OneDrive do caminho do arquivo', async () => {
    leitura.person = { id: 5 }
    cadastrarEmpresa(1, 'Empresa', { created_by_person_id: 5 })
    vincularContrato(1, { filePath: 'onedrive:01ABCXYZ' })

    const [empresa] = await enterprise.listMine(USUARIO)

    expect(empresa.contracts[0].item_id).toBe('01ABCXYZ')
  })

  it('caminho que não é do OneDrive não vira itemId', async () => {
    leitura.person = { id: 5 }
    cadastrarEmpresa(1, 'Empresa')
    vincularContrato(1, { filePath: '/var/arquivos/contrato.pdf' })

    const [empresa] = await enterprise.listMine(USUARIO)

    expect(empresa.contracts[0].item_id).toBeNull()
  })

  it('documento sem assinatura reporta status nulo', async () => {
    leitura.person = { id: 5 }
    cadastrarEmpresa(1, 'Empresa')
    banco.enterprise_document.push({
      enterprise_id: 1,
      document_id: 1,
      doc_type: 'attachment',
      is_primary: false
    })
    banco.document.push({
      id: 1,
      uuid: 'd-1',
      name: 'Anexo',
      status: 'draft',
      due_date: null,
      signature_id: null,
      file_resource_id: null
    })

    const [empresa] = await enterprise.listMine(USUARIO)

    expect(empresa.contracts[0].signature_status).toBeNull()
    expect(empresa.contracts[0].item_id).toBeNull()
  })

  it('vínculo apontando para documento inexistente é ignorado', async () => {
    leitura.person = { id: 5 }
    cadastrarEmpresa(1, 'Empresa')
    banco.enterprise_document.push({
      enterprise_id: 1,
      document_id: 999,
      doc_type: 'contract',
      is_primary: true
    })

    const [empresa] = await enterprise.listMine(USUARIO)

    expect(empresa.contracts).toEqual([])
  })
})

describe('listMine', () => {
  it('devolve vazio para quem não está identificado', async () => {
    expect(await enterprise.listMine(null)).toEqual([])
    expect(await enterprise.listMine({})).toEqual([])
  })

  it('devolve vazio quando a pessoa não existe', async () => {
    leitura.person = null
    expect(await enterprise.listMine(USUARIO)).toEqual([])
  })

  it('traz apenas as empresas criadas pela própria pessoa', async () => {
    leitura.person = { id: 5 }
    cadastrarEmpresa(1, 'Minha')

    await enterprise.listMine(USUARIO)

    expect(consultaDe('enterprise').where).toEqual({ active: true, created_by_person_id: 5 })
  })

  it('devolve vazio sem consultar contratos quando não há empresa', async () => {
    leitura.person = { id: 5 }

    expect(await enterprise.listMine(USUARIO)).toEqual([])
    expect(list.mock.calls.some((c) => c[0] === 'enterprise_document')).toBe(false)
  })
})

describe('listAllSelectable', () => {
  it('lista todas as ativas em ordem alfabética', async () => {
    await enterprise.listAllSelectable(USUARIO)

    const opcoes = consultaDe('enterprise')
    expect(opcoes.where).toEqual({ active: true })
    expect(opcoes.orderBy).toEqual([{ column: 'name', direction: 'ASC' }])
    expect(opcoes.select).toContain('cnpj')
  })
})

describe('listPending', () => {
  it('traz a fila de aprovação', async () => {
    await enterprise.listPending(USUARIO)

    expect(consultaDe('enterprise').where).toEqual({ active: true, status: 'pending' })
  })

  it('aceita busca por nome', async () => {
    await enterprise.listPending(USUARIO, { search: 'kohl' })

    expect(consultaDe('enterprise').where.name).toEqual({ op: 'ilike', value: '%kohl%' })
  })

  it('ignora filtro de cidade na fila de pendentes', async () => {
    await enterprise.listPending(USUARIO, { city: 'Joinville' })

    expect(consultaDe('enterprise').where.city).toBeUndefined()
  })
})

describe('listManage', () => {
  it('sem filtro de status, traz todas as ativas', async () => {
    await enterprise.listManage(USUARIO)

    expect(consultaDe('enterprise').where).toEqual({ active: true })
  })

  it.each([['pending'], ['active'], ['suspended'], ['inactive']])(
    'aceita o status %s',
    async (status) => {
      await enterprise.listManage(USUARIO, { status })
      expect(consultaDe('enterprise').where.status).toBe(status)
    }
  )

  it('ignora status desconhecido em vez de falhar', async () => {
    await enterprise.listManage(USUARIO, { status: 'inventado' })

    expect(consultaDe('enterprise').where.status).toBeUndefined()
  })

  it('a busca por nome vai para o banco', async () => {
    await enterprise.listManage(USUARIO, { search: 'kohl', city: 'Joinville' })

    expect(consultaDe('enterprise').where).toMatchObject({
      name: { op: 'ilike', value: '%kohl%' }
    })
  })

  it('a cidade não é comparada por igualdade exata no banco', async () => {
    await enterprise.listManage(USUARIO, { city: 'Jaraguá do Sul' })

    expect(consultaDe('enterprise').where.city).toBeUndefined()
  })

  it.each([
    ['sem acento e em maiúsculas', 'JARAGUA DO SUL'],
    ['com acento', 'Jaraguá do Sul'],
    ['em minúsculas', 'jaragua do sul']
  ])('encontra a empresa com a cidade escrita %s', async (_rotulo, escolhida) => {
    cadastrarEmpresa(1, 'Daqui', { city: 'JARAGUA DO SUL' })
    cadastrarEmpresa(2, 'De fora', { city: 'Joinville' })

    const { items } = await enterprise.listManage(USUARIO, { city: escolhida })

    expect(items.map((e) => e.name)).toEqual(['Daqui'])
  })

  it('a cidade da instituição tem precedência também na gestão', async () => {
    banco.institution.push({ id: 7, name: 'Campus Joinville', city: 'Joinville' })
    cadastrarEmpresa(1, 'Vinculada', { city: 'Jaraguá do Sul', institution_id: 7 })

    expect((await enterprise.listManage(USUARIO, { city: 'joinville' })).items).toHaveLength(1)
    expect((await enterprise.listManage(USUARIO, { city: 'jaragua do sul' })).items).toHaveLength(0)
  })

  it('pagina o resultado mesmo filtrando por cidade', async () => {
    for (let i = 1; i <= 11; i++) cadastrarEmpresa(i, `Empresa ${i}`, { city: 'JARAGUA DO SUL' })

    const primeira = await enterprise.listManage(USUARIO, { city: 'Jaraguá do Sul' })
    expect(primeira.items).toHaveLength(10)
    expect(primeira.hasMore).toBe(true)

    const segunda = await enterprise.listManage(USUARIO, { city: 'Jaraguá do Sul', page: 2 })
    expect(segunda.items).toHaveLength(1)
    expect(segunda.hasMore).toBe(false)
  })

  it('pagina no banco, pedindo um registro a mais', async () => {
    await enterprise.listManage(USUARIO, { page: 2 })

    const opcoes = consultaDe('enterprise')
    expect(opcoes.limit).toBe(11)
    expect(opcoes.offset).toBe(10)
  })

  it('sinaliza próxima página quando vem o registro extra', async () => {
    for (let i = 1; i <= 11; i++) cadastrarEmpresa(i, `Empresa ${i}`)

    const resultado = await enterprise.listManage(USUARIO)

    expect(resultado.items).toHaveLength(10)
    expect(resultado.hasMore).toBe(true)
  })
})

describe('updateStatus', () => {
  beforeEach(() => {
    leitura.enterprise = { name: 'Kohlbach', status: 'pending' }
  })

  it('exige o identificador', async () => {
    await expect(enterprise.updateStatus(USUARIO, '', 'active')).rejects.toMatchObject({
      status: 400,
      message: 'uuid_required'
    })
  })

  it('recusa status fora do enum', async () => {
    await expect(enterprise.updateStatus(USUARIO, 'e-1', 'aprovada')).rejects.toMatchObject({
      status: 400,
      message: 'invalid_status'
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('recusa empresa inexistente', async () => {
    leitura.enterprise = null

    await expect(enterprise.updateStatus(USUARIO, 'e-1', 'active')).rejects.toMatchObject({
      status: 404,
      message: 'enterprise_not_found'
    })
  })

  it('recusa quando a atualização não atinge nenhuma linha', async () => {
    update.mockResolvedValue([])

    await expect(enterprise.updateStatus(USUARIO, 'e-1', 'active')).rejects.toMatchObject({
      status: 404
    })
  })

  it('aprova a empresa e devolve o novo status', async () => {
    expect(await enterprise.updateStatus(USUARIO, 'e-1', 'active')).toEqual({
      uuid: 'e-uuid',
      status: 'active'
    })
    expect(update.mock.calls[0][1]).toEqual({ status: 'active' })
    expect(update.mock.calls[0][2].where).toEqual({ uuid: 'e-1' })
  })

  it('registra a transição na trilha de auditoria', async () => {
    await enterprise.updateStatus(USUARIO, 'e-1', 'active', 'req-5')

    expect(registrar).toHaveBeenCalledWith(USUARIO, 'enterprise.status', {
      entity: 'enterprise',
      ref: 'Kohlbach',
      detail: { uuid: 'e-1', from: 'pending', to: 'active' },
      requestId: 'req-5'
    })
  })

  it('não polui a trilha quando o status não mudou', async () => {
    leitura.enterprise = { name: 'Kohlbach', status: 'active' }

    await enterprise.updateStatus(USUARIO, 'e-1', 'active')

    expect(registrar).not.toHaveBeenCalled()
  })
})

describe('create', () => {
  beforeEach(() => {
    leitura.person = { id: 5, institution_id: 7 }
  })

  it('exige usuário identificado', async () => {
    await expect(enterprise.create(null, { name: 'X' })).rejects.toMatchObject({ status: 401 })
    await expect(enterprise.create({}, { name: 'X' })).rejects.toMatchObject({ status: 401 })
  })

  it('recusa quando a pessoa não existe', async () => {
    leitura.person = null

    await expect(enterprise.create(USUARIO, { name: 'X' })).rejects.toMatchObject({
      status: 404,
      message: 'person_not_found'
    })
  })

  it.each([['vazio', ''], ['só espaços', '   '], ['ausente', undefined]])(
    'recusa nome %s',
    async (_rotulo, name) => {
      await expect(enterprise.create(USUARIO, { name })).rejects.toMatchObject({
        status: 400,
        message: 'name_required'
      })
    }
  )

  it('recusa CNPJ inválido', async () => {
    await expect(
      enterprise.create(USUARIO, { name: 'Empresa', cnpj: '11222333000182' })
    ).rejects.toMatchObject({ status: 400, message: 'invalid_cnpj' })
  })

  it('recusa CNPJ já cadastrado', async () => {
    leitura.enterprise = { id: 9 }

    await expect(
      enterprise.create(USUARIO, { name: 'Empresa', cnpj: CNPJ_VALIDO })
    ).rejects.toMatchObject({ status: 409, message: 'cnpj_already_exists' })
  })

  it('traduz violação de unicidade do banco em conflito', async () => {
    const erro = new Error('duplicate key')
    erro.code = '23505'
    create.mockRejectedValueOnce(erro)

    await expect(
      enterprise.create(USUARIO, { name: 'Empresa', cnpj: CNPJ_VALIDO })
    ).rejects.toMatchObject({ status: 409, message: 'cnpj_already_exists' })
  })

  it('propaga erro de banco que não seja conflito', async () => {
    create.mockRejectedValueOnce(new Error('conexão perdida'))

    await expect(enterprise.create(USUARIO, { name: 'Empresa' })).rejects.toThrow('conexão perdida')
  })

  it('nasce pendente de aprovação, vinculada ao criador e à instituição dele', async () => {
    const resultado = await enterprise.create(USUARIO, { name: '  Kohlbach  ' })

    const linha = criacaoDe('enterprise')[1]
    expect(linha.name).toBe('Kohlbach')
    expect(linha.status).toBe('pending')
    expect(linha.active).toBe(true)
    expect(linha.institution_id).toBe(7)
    expect(linha.created_by_person_id).toBe(5)
    expect(resultado).toEqual({ uuid: 'e-uuid' })
  })

  it('normaliza o CNPJ para apenas dígitos', async () => {
    await enterprise.create(USUARIO, { name: 'Empresa', cnpj: '11.222.333/0001-81' })

    expect(criacaoDe('enterprise')[1].cnpj).toBe(CNPJ_VALIDO)
  })

  it('campo opcional em branco é gravado como nulo', async () => {
    await enterprise.create(USUARIO, { name: 'Empresa', city: '   ', contact_email: '' })

    const linha = criacaoDe('enterprise')[1]
    expect(linha.city).toBeNull()
    expect(linha.contact_email).toBeNull()
    expect(linha.cnpj).toBeNull()
  })

  it('sem arquivo, não cria documento nem anexo', async () => {
    await enterprise.create(USUARIO, { name: 'Empresa' })

    expect(criacaoDe('file_resource')).toBeUndefined()
    expect(criacaoDe('document')).toBeUndefined()
    expect(criacaoDe('enterprise_document')).toBeUndefined()
  })

  it('com arquivo, guarda o conteúdo e vincula como anexo principal', async () => {
    const arquivo = { originalname: 'contrato.pdf', buffer: Buffer.from('conteudo') }

    await enterprise.create(USUARIO, { name: 'Empresa' }, arquivo)

    expect(criacaoDe('file_resource')[1]).toMatchObject({
      name: 'contrato.pdf',
      status: 'uploaded',
      content: arquivo.buffer
    })
    expect(criacaoDe('document')[1]).toMatchObject({ status: 'draft', file_resource_id: 200 })
    expect(criacaoDe('enterprise_document')[1]).toEqual({
      enterprise_id: 100,
      document_id: 300,
      doc_type: 'attachment',
      is_primary: true
    })
  })

  it('arquivo sem nome recebe um rótulo padrão', async () => {
    await enterprise.create(USUARIO, { name: 'Empresa' }, { buffer: Buffer.from('x') })

    expect(criacaoDe('file_resource')[1].name).toBe('documento')
    expect(criacaoDe('document')[1].name).toBe('Documento da empresa')
  })

  it('registra o cadastro na trilha de auditoria', async () => {
    await enterprise.create(USUARIO, { name: 'Kohlbach', cnpj: CNPJ_VALIDO }, null, 'req-7')

    expect(registrar).toHaveBeenCalledWith(USUARIO, 'enterprise.create', {
      entity: 'enterprise',
      ref: 'Kohlbach',
      detail: { uuid: 'e-uuid', cnpj: CNPJ_VALIDO, with_document: false },
      requestId: 'req-7'
    })
  })

  it('a trilha registra que veio documento junto', async () => {
    await enterprise.create(USUARIO, { name: 'Empresa' }, { buffer: Buffer.from('x') })

    expect(registrar.mock.calls[0][2].detail.with_document).toBe(true)
  })
})

describe('fallbacks sem usuário identificado', () => {
  it.each([
    ['listAllSelectable', () => enterprise.listAllSelectable(null)],
    ['listPending', () => enterprise.listPending(null)],
    ['listManage', () => enterprise.listManage(null)]
  ])('%s consulta como usuário de sistema', async (_rotulo, chamar) => {
    await chamar()
    expect(list.mock.calls[0][3]).toBe(SYSTEM_USER)
  })

  it('updateStatus consulta como usuário de sistema', async () => {
    leitura.enterprise = { name: 'Kohlbach', status: 'pending' }

    await enterprise.updateStatus(null, 'e-1', 'active')

    expect(read.mock.calls[0][3]).toBe(SYSTEM_USER)
  })

  it('lookupCnpj consulta como usuário de sistema', async () => {
    buscarNaWeb.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

    await enterprise.lookupCnpj(null, CNPJ_VALIDO)

    expect(read.mock.calls[0][3]).toBe(SYSTEM_USER)
  })
})

describe('dígito verificador do CNPJ', () => {
  it.each([
    ['primeiro dígito zero', '10000008000101'],
    ['segundo dígito zero', '10000001000190']
  ])('aceita CNPJ com %s', async (_rotulo, cnpj) => {
    buscarNaWeb.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })

    await expect(enterprise.lookupCnpj(USUARIO, cnpj)).resolves.toMatchObject({ cnpj })
  })
})

describe('instituição na visão de gestão', () => {
  it('usa a cidade da instituição e expõe o vínculo', async () => {
    banco.institution.push({ id: 7, name: 'Campus Joinville', city: 'Joinville' })
    cadastrarEmpresa(1, 'Empresa', { city: 'Jaraguá do Sul', institution_id: 7 })

    const { items } = await enterprise.listManage(USUARIO)

    expect(items[0].city).toBe('Joinville')
    expect(items[0].institution).toEqual({ name: 'Campus Joinville', city: 'Joinville' })
    expect(items[0].contracts).toEqual([])
  })

  it('empresa sem cidade nem instituição reporta cidade nula', async () => {
    cadastrarEmpresa(1, 'Empresa', { city: null, institution_id: null })

    const { items } = await enterprise.listManage(USUARIO)

    expect(items[0].city).toBeNull()
    expect(items[0].institution).toBeNull()
  })

  it('no catálogo, empresa sem cidade nem instituição também reporta nulo', async () => {
    cadastrarEmpresa(1, 'Empresa', { city: null, institution_id: null })
    vincularContrato(1)

    const { items } = await enterprise.list(USUARIO)

    expect(items[0].city).toBeNull()
  })

  it('filtro de cidade usa a instituição quando a empresa está vinculada', async () => {
    banco.institution.push({ id: 7, name: 'Campus Joinville', city: 'Joinville' })
    cadastrarEmpresa(1, 'Vinculada', { city: 'Jaraguá do Sul', institution_id: 7 })
    vincularContrato(1)

    expect((await enterprise.list(USUARIO, { city: 'joinville' })).items).toHaveLength(1)
    expect((await enterprise.list(USUARIO, { city: 'jaragua do sul' })).items).toHaveLength(0)
  })
})
