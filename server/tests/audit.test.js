import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const logger = require('../logger.js')
const audit = require('../services/audit.js')

const SYSTEM_USER = 'system:audit'
const ATOR = { sub: 'p-1', email: 'ra.cardoso@catolicasc.edu.br' }

let create
let list

beforeEach(() => {
  create = vi.spyOn(crud, 'create').mockResolvedValue({ rowCount: 1 })
  list = vi.spyOn(crud, 'list').mockResolvedValue([])
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})

const opcoesDaConsulta = () => list.mock.calls[0][1]
const linhasDeAuditoria = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, action: 'manager.invite' }))

describe('record', () => {
  it('grava quem agiu, o que fez e sobre quem', async () => {
    await audit.record(ATOR, 'manager.invite', {
      entity: 'role_invite',
      ref: 'novo@catolicasc.edu.br',
      detail: { promoted_now: true },
      requestId: 'req-9'
    })

    const [tabela, linha, opcoes, usuario] = create.mock.calls[0]
    expect(tabela).toBe('audit_log')
    expect(linha).toEqual({
      actor_uuid: 'p-1',
      actor_email: 'ra.cardoso@catolicasc.edu.br',
      action: 'manager.invite',
      entity: 'role_invite',
      entity_ref: 'novo@catolicasc.edu.br',
      detail: { promoted_now: true },
      request_id: 'req-9'
    })
    expect(opcoes).toEqual({ returning: false })
    expect(usuario).toBe(SYSTEM_USER)
  })

  it('usa null nos campos opcionais omitidos', async () => {
    await audit.record(ATOR, 'enterprise.status', { entity: 'enterprise' })

    const linha = create.mock.calls[0][1]
    expect(linha.entity_ref).toBeNull()
    expect(linha.detail).toBeNull()
    expect(linha.request_id).toBeNull()
  })

  it('guarda o e-mail do autor de forma redundante, para sobreviver à conta', async () => {
    await audit.record(ATOR, 'manager.demote', { entity: 'person' })

    expect(create.mock.calls[0][1].actor_uuid).toBe('p-1')
    expect(create.mock.calls[0][1].actor_email).toBe(ATOR.email)
  })

  it('aceita ator sem e-mail', async () => {
    await audit.record({ sub: 'p-2' }, 'x', { entity: 'y' })
    expect(create.mock.calls[0][1].actor_email).toBeNull()
  })

  it('não quebra quando chamado sem opções', async () => {
    await expect(audit.record(ATOR, 'x')).resolves.toBeUndefined()
    expect(create).toHaveBeenCalledOnce()
  })

  it('falha de auditoria nunca derruba a ação principal', async () => {
    create.mockRejectedValue(new Error('coluna inexistente'))

    await expect(audit.record(ATOR, 'manager.invite', { entity: 'role_invite' })).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      'audit_record_failed',
      expect.objectContaining({ action: 'manager.invite', error: 'coluna inexistente' })
    )
  })
})

describe('list', () => {
  it('sem filtros, traz a página mais recente', async () => {
    await audit.list(ATOR)

    const opcoes = opcoesDaConsulta()
    expect(opcoes.where).toEqual({})
    expect(opcoes.offset).toBe(0)
    expect(opcoes.orderBy).toEqual([
      { column: 'insert_date', direction: 'DESC' },
      { column: 'id', direction: 'DESC' }
    ])
  })

  it('pede um registro a mais do que a página para saber se há próxima', async () => {
    list.mockResolvedValue(linhasDeAuditoria(11))

    const resultado = await audit.list(ATOR)

    expect(opcoesDaConsulta().limit).toBe(resultado.pageSize + 1)
    expect(resultado.items).toHaveLength(10)
    expect(resultado.hasMore).toBe(true)
  })

  it('não anuncia próxima página quando a atual não encheu', async () => {
    list.mockResolvedValue(linhasDeAuditoria(10))

    const resultado = await audit.list(ATOR)

    expect(resultado.items).toHaveLength(10)
    expect(resultado.hasMore).toBe(false)
  })

  it('calcula o deslocamento pela página pedida', async () => {
    await audit.list(ATOR, { page: 3 })
    expect(opcoesDaConsulta().offset).toBe(20)
  })

  it.each([
    ['zero', 0],
    ['negativa', -5],
    ['não numérica', 'abc'],
    ['ausente', undefined]
  ])('trata página %s como a primeira', async (_rotulo, page) => {
    await audit.list(ATOR, { page })
    expect(opcoesDaConsulta().offset).toBe(0)
  })

  it('filtra ação por igualdade exata', async () => {
    await audit.list(ATOR, { action: 'manager.demote' })
    expect(opcoesDaConsulta().where).toEqual({ action: 'manager.demote' })
  })

  it('filtra autor e alvo por trecho, sem diferenciar maiúsculas', async () => {
    await audit.list(ATOR, { actor: 'ra.card', target: 'kohlbach' })

    expect(opcoesDaConsulta().where).toEqual({
      actor_email: { op: 'ilike', value: '%ra.card%' },
      entity_ref: { op: 'ilike', value: '%kohlbach%' }
    })
  })

  it('monta intervalo de datas inclusivo nas duas pontas', async () => {
    await audit.list(ATOR, { from: '2026-10-01', to: '2026-10-26' })

    const [inicio, fim] = opcoesDaConsulta().where.insert_date
    expect(inicio).toEqual({ op: '>=', value: new Date('2026-10-01T00:00:00') })
    expect(fim).toEqual({ op: '<', value: new Date('2026-10-27T00:00:00') })
  })

  it('aceita apenas uma das pontas do intervalo', async () => {
    await audit.list(ATOR, { from: '2026-10-01' })
    expect(opcoesDaConsulta().where.insert_date).toHaveLength(1)

    list.mockClear()
    await audit.list(ATOR, { to: '2026-10-26' })
    expect(opcoesDaConsulta().where.insert_date).toHaveLength(1)
  })

  it.each([
    ['dia inexistente', '2026-13-45'],
    ['formato brasileiro', '26/10/2026'],
    ['texto', 'ontem'],
    ['vazio', '   ']
  ])('ignora data %s', async (_rotulo, from) => {
    await audit.list(ATOR, { from })
    expect(opcoesDaConsulta().where.insert_date).toBeUndefined()
  })

  it('ignora filtro de texto em branco', async () => {
    await audit.list(ATOR, { action: '  ', actor: '', target: '   ' })
    expect(opcoesDaConsulta().where).toEqual({})
  })

  it('consulta como o usuário informado', async () => {
    await audit.list(ATOR)
    expect(list.mock.calls[0][3]).toBe(ATOR)
  })

  it('sem usuário, consulta como o usuário de sistema', async () => {
    await audit.list(null)
    expect(list.mock.calls[0][3]).toBe(SYSTEM_USER)
  })
})

describe('suggest', () => {
  it('não consulta com menos de dois caracteres', async () => {
    expect(await audit.suggest(ATOR, { q: 'r' })).toEqual([])
    expect(await audit.suggest(ATOR, { q: '' })).toEqual([])
    expect(await audit.suggest(ATOR, {})).toEqual([])
    expect(list).not.toHaveBeenCalled()
  })

  it('busca no e-mail do autor quando o campo é actor', async () => {
    list.mockResolvedValue([{ actor_email: 'ra.cardoso@catolicasc.edu.br' }])

    const sugestoes = await audit.suggest(ATOR, { q: 'ra.card', field: 'actor' })

    expect(opcoesDaConsulta().select).toEqual(['actor_email'])
    expect(opcoesDaConsulta().where).toEqual({ actor_email: { op: 'ilike', value: '%ra.card%' } })
    expect(sugestoes).toEqual(['ra.cardoso@catolicasc.edu.br'])
  })

  it.each([['target'], ['inexistente'], [undefined]])(
    'busca no alvo quando o campo é %s',
    async (field) => {
      list.mockResolvedValue([{ entity_ref: 'Kohlbach Motores' }])

      const sugestoes = await audit.suggest(ATOR, { q: 'kohl', field })

      expect(opcoesDaConsulta().select).toEqual(['entity_ref'])
      expect(sugestoes).toEqual(['Kohlbach Motores'])
    }
  )

  it('remove repetidos preservando a ordem do mais recente', async () => {
    list.mockResolvedValue([
      { entity_ref: 'Kohlbach' },
      { entity_ref: 'Menegotti' },
      { entity_ref: 'Kohlbach' }
    ])

    expect(await audit.suggest(ATOR, { q: 'ko' })).toEqual(['Kohlbach', 'Menegotti'])
  })

  it('devolve no máximo oito sugestões', async () => {
    list.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => ({ entity_ref: `Empresa ${i}` }))
    )

    expect(await audit.suggest(ATOR, { q: 'emp' })).toHaveLength(8)
  })

  it('ignora valores nulos ou vazios', async () => {
    list.mockResolvedValue([{ entity_ref: null }, { entity_ref: '' }, { entity_ref: 'Trapp' }])

    expect(await audit.suggest(ATOR, { q: 'tr' })).toEqual(['Trapp'])
  })

  it('limita a varredura a cem registros recentes', async () => {
    await audit.suggest(ATOR, { q: 'ko' })
    expect(opcoesDaConsulta().limit).toBe(100)
  })
})
