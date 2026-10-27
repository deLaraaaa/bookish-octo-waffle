import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const logger = require('../logger.js')
const audit = require('../services/audit.js')
const admin = require('../services/admin.js')

const SYSTEM_USER = 'system:admin'
const ROLE_ID = 2
const ATOR = { sub: 'p-admin', email: 'admin@catolicasc.edu.br' }

let read
let list
let update
let remove
let upcreate
let registrar

let identityRetorno
let personRetorno
let roleRetorno

beforeEach(() => {
  identityRetorno = null
  personRetorno = null
  roleRetorno = { id: ROLE_ID }

  read = vi.spyOn(crud, 'read').mockImplementation(async (tabela) => {
    if (tabela === 'role') return roleRetorno
    if (tabela === 'identity') return identityRetorno
    if (tabela === 'person') return personRetorno
    return null
  })
  list = vi.spyOn(crud, 'list').mockResolvedValue([])
  update = vi.spyOn(crud, 'update').mockResolvedValue([])
  remove = vi.spyOn(crud, 'remove').mockResolvedValue({ rowCount: 1 })
  upcreate = vi.spyOn(crud, 'upcreate').mockResolvedValue({
    id: 1,
    email: 'novo@catolicasc.edu.br',
    consumed_at: null
  })
  registrar = vi.spyOn(audit, 'record').mockResolvedValue(undefined)
  vi.spyOn(logger, 'info').mockImplementation(() => {})
})

const chamadaUpdate = (tabela) => update.mock.calls.find((c) => c[0] === tabela)

describe('createManagerInvite', () => {
  it.each([
    ['vazio', ''],
    ['só espaços', '   '],
    ['sem arroba', 'fulano'],
    ['ausente', undefined]
  ])('recusa e-mail %s', async (_rotulo, email) => {
    await expect(admin.createManagerInvite(ATOR, { email })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_email'
    })
  })

  it('recusa domínio fora da instituição', async () => {
    await expect(
      admin.createManagerInvite(ATOR, { email: 'alguem@gmail.com' })
    ).rejects.toMatchObject({ status: 400, code: 'domain_not_allowed' })
  })

  it.each([['catolicasc.edu.br'], ['catolicasc.org.br']])('aceita o domínio %s', async (dominio) => {
    await expect(admin.createManagerInvite(ATOR, { email: `novo@${dominio}` })).resolves.toBeTruthy()
  })

  it('normaliza o e-mail antes de gravar', async () => {
    await admin.createManagerInvite(ATOR, { email: '  NOVO@Catolicasc.Edu.BR  ' })

    expect(upcreate.mock.calls[0][1].email).toBe('novo@catolicasc.edu.br')
  })

  it('falha quando o papel MANAGER não existe no banco', async () => {
    roleRetorno = null

    await expect(
      admin.createManagerInvite(ATOR, { email: 'novo@catolicasc.edu.br' })
    ).rejects.toMatchObject({ status: 500, code: 'manager_role_missing' })
  })

  it('convida quem ainda não tem login, sem promover ninguém', async () => {
    const resultado = await admin.createManagerInvite(ATOR, { email: 'novo@catolicasc.edu.br' })

    expect(upcreate.mock.calls[0][1].consumed_at).toBeNull()
    expect(chamadaUpdate('person')).toBeUndefined()
    expect(resultado.promoted_now).toBe(false)
  })

  it('promove na hora quem já tem login', async () => {
    identityRetorno = { person_id: 77 }
    upcreate.mockResolvedValue({ id: 1, email: 'ja@catolicasc.edu.br', consumed_at: new Date() })

    const resultado = await admin.createManagerInvite(ATOR, { email: 'ja@catolicasc.edu.br' })

    expect(upcreate.mock.calls[0][1].consumed_at).toBeInstanceOf(Date)
    expect(chamadaUpdate('person')).toBeDefined()
    expect(chamadaUpdate('person')[1]).toEqual({ role_id: ROLE_ID })
    expect(chamadaUpdate('person')[2].where).toEqual({ id: 77 })
    expect(resultado).toEqual({
      email: 'ja@catolicasc.edu.br',
      consumed: true,
      promoted_now: true
    })
  })

  it('usa o e-mail como chave de conflito, para não duplicar convite', async () => {
    await admin.createManagerInvite(ATOR, { email: 'novo@catolicasc.edu.br' })

    const [tabela, , conflito, opcoes, usuario] = upcreate.mock.calls[0]
    expect(tabela).toBe('role_invite')
    expect(conflito).toEqual({ columns: ['email'] })
    expect(opcoes.updateColumns).toEqual(['role_id', 'consumed_at', 'active'])
    expect(usuario).toBe(SYSTEM_USER)
  })

  it('registra o convite na trilha de auditoria', async () => {
    await admin.createManagerInvite(ATOR, { email: 'novo@catolicasc.edu.br' }, 'req-1')

    expect(registrar).toHaveBeenCalledWith(ATOR, 'manager.invite', {
      entity: 'role_invite',
      ref: 'novo@catolicasc.edu.br',
      detail: { promoted_now: false },
      requestId: 'req-1'
    })
  })
})

describe('listManagerInvites', () => {
  it('traduz a data de consumo em um booleano', async () => {
    const quando = new Date('2026-10-01T10:00:00Z')
    list.mockResolvedValue([
      { email: 'a@catolicasc.edu.br', consumed_at: quando, insert_date: quando },
      { email: 'b@catolicasc.edu.br', consumed_at: null, insert_date: quando }
    ])

    expect(await admin.listManagerInvites()).toEqual([
      { email: 'a@catolicasc.edu.br', consumed: true, invited_at: quando },
      { email: 'b@catolicasc.edu.br', consumed: false, invited_at: quando }
    ])
  })

  it('lista só os convites ativos do papel MANAGER, do mais novo ao mais antigo', async () => {
    await admin.listManagerInvites()

    const opcoes = list.mock.calls[0][1]
    expect(opcoes.where).toEqual({ role_id: ROLE_ID, active: true })
    expect(opcoes.orderBy).toEqual([{ column: 'insert_date', direction: 'DESC' }])
  })
})

describe('revokeManagerInvite', () => {
  it('recusa e-mail vazio', async () => {
    await expect(admin.revokeManagerInvite(ATOR, '  ')).rejects.toMatchObject({
      status: 400,
      code: 'invalid_email'
    })
  })

  it('remove o convite normalizando o e-mail', async () => {
    const resultado = await admin.revokeManagerInvite(ATOR, '  ALGUEM@Catolicasc.edu.br ')

    expect(remove.mock.calls[0][1].where).toEqual({ email: 'alguem@catolicasc.edu.br' })
    expect(resultado).toEqual({ ok: true, removed: 1 })
  })

  it('registra na auditoria quando removeu alguma coisa', async () => {
    await admin.revokeManagerInvite(ATOR, 'alguem@catolicasc.edu.br', 'req-2')

    expect(registrar).toHaveBeenCalledWith(ATOR, 'manager.invite_revoke', {
      entity: 'role_invite',
      ref: 'alguem@catolicasc.edu.br',
      requestId: 'req-2'
    })
  })

  it('não polui a trilha quando não havia convite para remover', async () => {
    remove.mockResolvedValue({ rowCount: 0 })

    const resultado = await admin.revokeManagerInvite(ATOR, 'inexistente@catolicasc.edu.br')

    expect(resultado).toEqual({ ok: true, removed: 0 })
    expect(registrar).not.toHaveBeenCalled()
  })
})

describe('listManagers', () => {
  it('devolve lista vazia sem buscar identidades', async () => {
    list.mockResolvedValue([])

    expect(await admin.listManagers()).toEqual([])
    expect(list).toHaveBeenCalledOnce()
  })

  it('junta cada gestor ao seu e-mail', async () => {
    list
      .mockResolvedValueOnce([
        { id: 1, uuid: 'u-1', full_name: 'Ana' },
        { id: 2, uuid: 'u-2', full_name: 'Bruno' }
      ])
      .mockResolvedValueOnce([
        { person_id: 2, email: 'bruno@catolicasc.edu.br' },
        { person_id: 1, email: 'ana@catolicasc.edu.br' }
      ])

    expect(await admin.listManagers()).toEqual([
      { uuid: 'u-1', name: 'Ana', email: 'ana@catolicasc.edu.br' },
      { uuid: 'u-2', name: 'Bruno', email: 'bruno@catolicasc.edu.br' }
    ])
  })

  it('mantém o gestor na lista mesmo sem identidade vinculada', async () => {
    list
      .mockResolvedValueOnce([{ id: 1, uuid: 'u-1', full_name: 'Ana' }])
      .mockResolvedValueOnce([])

    expect(await admin.listManagers()).toEqual([{ uuid: 'u-1', name: 'Ana', email: null }])
  })

  it('busca as identidades dos gestores em uma consulta só', async () => {
    list
      .mockResolvedValueOnce([
        { id: 1, uuid: 'u-1', full_name: 'Ana' },
        { id: 2, uuid: 'u-2', full_name: 'Bruno' }
      ])
      .mockResolvedValueOnce([])

    await admin.listManagers()

    expect(list.mock.calls[1][1].where).toEqual({ person_id: { op: 'in', value: [1, 2] } })
  })
})

describe('demoteManager', () => {
  it('exige o identificador da pessoa', async () => {
    await expect(admin.demoteManager(ATOR, '')).rejects.toMatchObject({
      status: 400,
      code: 'uuid_required'
    })
  })

  it('recusa pessoa inexistente', async () => {
    personRetorno = null

    await expect(admin.demoteManager(ATOR, 'u-1')).rejects.toMatchObject({
      status: 404,
      code: 'person_not_found'
    })
  })

  it('recusa quem não é gestor', async () => {
    personRetorno = { id: 5, uuid: 'u-1', full_name: 'Ana', role_id: 99 }

    await expect(admin.demoteManager(ATOR, 'u-1')).rejects.toMatchObject({
      status: 400,
      code: 'not_a_manager'
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('remove o papel e desativa o convite que o sustentava', async () => {
    personRetorno = { id: 5, uuid: 'u-1', full_name: 'Ana', role_id: ROLE_ID }
    identityRetorno = { email: 'ANA@catolicasc.edu.br' }

    expect(await admin.demoteManager(ATOR, 'u-1')).toEqual({ ok: true })

    expect(chamadaUpdate('person')[1]).toEqual({ role_id: null })
    expect(chamadaUpdate('role_invite')[1]).toEqual({ active: false })
    expect(chamadaUpdate('role_invite')[2].where).toEqual({ email: 'ana@catolicasc.edu.br' })
  })

  it('rebaixa mesmo sem identidade, usando o uuid como referência', async () => {
    personRetorno = { id: 5, uuid: 'u-1', full_name: 'Ana', role_id: ROLE_ID }
    identityRetorno = null

    await admin.demoteManager(ATOR, 'u-1')

    expect(chamadaUpdate('role_invite')).toBeUndefined()
    expect(registrar.mock.calls[0][2].ref).toBe('u-1')
  })

  it('registra o rebaixamento na trilha de auditoria', async () => {
    personRetorno = { id: 5, uuid: 'u-1', full_name: 'Ana', role_id: ROLE_ID }
    identityRetorno = { email: 'ana@catolicasc.edu.br' }

    await admin.demoteManager(ATOR, 'u-1', 'req-3')

    expect(registrar).toHaveBeenCalledWith(ATOR, 'manager.demote', {
      entity: 'person',
      ref: 'ana@catolicasc.edu.br',
      detail: { person: 'u-1', name: 'Ana' },
      requestId: 'req-3'
    })
  })

  it('compara o papel por valor numérico', async () => {
    personRetorno = { id: 5, uuid: 'u-1', full_name: 'Ana', role_id: String(ROLE_ID) }

    await expect(admin.demoteManager(ATOR, 'u-1')).resolves.toEqual({ ok: true })
  })
})
