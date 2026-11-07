import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const db = require('../db.js')
const audit = require('../services/audit.js')
const notifications = require('../services/notifications.js')

const GESTOR = { sub: 'p-1', email: 'gestor@catolicasc.org.br' }
const AGORA = new Date('2026-10-30T12:00:00Z')

let consultas
let respostas
let registrar

function responderCom(mapa) {
  respostas = mapa
}

beforeEach(() => {
  consultas = []
  respostas = {}
  registrar = vi.spyOn(audit, 'record').mockResolvedValue(undefined)

  vi.spyOn(db, 'query').mockImplementation(async (texto, params) => {
    consultas.push({ texto, params })
    for (const [chave, valor] of Object.entries(respostas)) {
      if (texto.includes(chave)) return typeof valor === 'function' ? valor(params) : valor
    }
    return { rows: [] }
  })

  vi.spyOn(crud, 'read').mockImplementation(async (tabela) =>
    tabela === 'person' ? { id: 10 } : null
  )
})

describe('scanExpiring', () => {
  it('consulta os três marcos de vencimento', async () => {
    await notifications.scanExpiring(AGORA)

    const buscas = consultas.filter((c) => c.texto.includes('FROM document'))
    expect(buscas).toHaveLength(3)
  })

  it('só considera contrato assinado, ativo e com vencimento definido', async () => {
    await notifications.scanExpiring(AGORA)

    const busca = consultas.find((c) => c.texto.includes('FROM document'))
    expect(busca.texto).toContain("d.status = 'signed'")
    expect(busca.texto).toContain('d.active = true')
    expect(busca.texto).toContain('d.due_date IS NOT NULL')
  })

  it('a janela de cada marco cobre exatamente um dia', async () => {
    await notifications.scanExpiring(AGORA)

    const busca = consultas.find((c) => c.texto.includes('FROM document'))
    const [inicio, fim] = busca.params
    expect(fim.getTime() - inicio.getTime()).toBe(86400000)
  })

  it('usa ON CONFLICT para não duplicar o mesmo aviso', async () => {
    responderCom({ 'FROM document': { rows: [{ id: 7, due_date: AGORA }] } })

    await notifications.scanExpiring(AGORA)

    const insercao = consultas.find((c) => c.texto.includes('INSERT INTO contract_notification '))
    expect(insercao.texto).toContain('ON CONFLICT (document_id, milestone) DO NOTHING')
  })

  it('devolve apenas os avisos realmente criados', async () => {
    responderCom({
      'FROM document': { rows: [{ id: 7, due_date: AGORA }] },
      'INSERT INTO contract_notification ': { rows: [] }
    })

    expect(await notifications.scanExpiring(AGORA)).toEqual([])
  })

  it('registra na auditoria quando cria avisos', async () => {
    responderCom({
      'FROM document': { rows: [{ id: 7, due_date: AGORA }] },
      'INSERT INTO contract_notification ': { rows: [{ id: 1, uuid: 'n-1' }] }
    })

    await notifications.scanExpiring(AGORA)

    expect(registrar).toHaveBeenCalledWith(
      null,
      'contract_notification.created',
      expect.objectContaining({ entity: 'contract_notification' })
    )
  })

  it('não polui a auditoria quando nada foi criado', async () => {
    await notifications.scanExpiring(AGORA)

    expect(registrar).not.toHaveBeenCalled()
  })

  it('os marcos são 90, 30 e 7 dias', () => {
    expect(notifications.MARCOS.map((m) => m.dias)).toEqual([90, 30, 7])
    expect(notifications.MARCOS.map((m) => m.nome)).toEqual(['3_meses', '1_mes', '1_semana'])
  })
})

describe('listForPerson', () => {
  it('exige sessão', async () => {
    await expect(notifications.listForPerson({})).rejects.toMatchObject({ status: 401 })
  })

  it('recusa pessoa inexistente', async () => {
    crud.read.mockResolvedValue(null)

    await expect(notifications.listForPerson(GESTOR)).rejects.toMatchObject({ status: 404 })
  })

  it('devolve os itens e a contagem de não lidas', async () => {
    responderCom({
      'SELECT n.uuid': { rows: [{ uuid: 'n-1', milestone: '1_mes', read: false }] },
      'count(*)::int': { rows: [{ total: 3 }] }
    })

    const r = await notifications.listForPerson(GESTOR)

    expect(r.items).toHaveLength(1)
    expect(r.unread).toBe(3)
  })

  it('filtra as já lidas quando pedido', async () => {
    await notifications.listForPerson(GESTOR, { unreadOnly: true })

    const busca = consultas.find((c) => c.texto.includes('SELECT n.uuid'))
    expect(busca.texto).toContain('AND r.id IS NULL')
  })

  it('sem o filtro, traz lidas e não lidas', async () => {
    await notifications.listForPerson(GESTOR)

    const busca = consultas.find((c) => c.texto.includes('SELECT n.uuid'))
    expect(busca.texto).not.toContain('AND r.id IS NULL\n      ORDER')
  })

  it('limita o volume devolvido', async () => {
    await notifications.listForPerson(GESTOR, { limit: 5000 })

    const busca = consultas.find((c) => c.texto.includes('SELECT n.uuid'))
    expect(busca.params[1]).toBe(100)
  })

  it('ordena pelo vencimento mais próximo', async () => {
    await notifications.listForPerson(GESTOR)

    const busca = consultas.find((c) => c.texto.includes('SELECT n.uuid'))
    expect(busca.texto).toContain('ORDER BY n.due_date ASC')
  })
})

describe('markRead', () => {
  it('exige o identificador', async () => {
    await expect(notifications.markRead(GESTOR, '')).rejects.toMatchObject({
      status: 400,
      message: 'uuid_required'
    })
  })

  it('marca como lida', async () => {
    responderCom({ 'INSERT INTO contract_notification_read': { rows: [{ id: 1 }] } })

    expect(await notifications.markRead(GESTOR, 'n-1')).toEqual({ uuid: 'n-1', read: true })
  })

  it('é idempotente: marcar de novo não falha', async () => {
    responderCom({
      'INSERT INTO contract_notification_read': { rows: [] },
      'SELECT 1 FROM contract_notification': { rows: [{ '?column?': 1 }] }
    })

    expect(await notifications.markRead(GESTOR, 'n-1')).toEqual({ uuid: 'n-1', read: true })
  })

  it('recusa aviso que não existe', async () => {
    responderCom({
      'INSERT INTO contract_notification_read': { rows: [] },
      'SELECT 1 FROM contract_notification': { rows: [] }
    })

    await expect(notifications.markRead(GESTOR, 'n-404')).rejects.toMatchObject({ status: 404 })
  })

  it('cada pessoa tem a própria leitura', async () => {
    responderCom({ 'INSERT INTO contract_notification_read': { rows: [{ id: 1 }] } })

    await notifications.markRead(GESTOR, 'n-1')

    const insercao = consultas.find((c) => c.texto.includes('INSERT INTO contract_notification_read'))
    expect(insercao.params[0]).toBe(10)
    expect(insercao.texto).toContain('ON CONFLICT (notification_id, person_id) DO NOTHING')
  })
})

describe('markAllRead', () => {
  it('informa quantas foram marcadas', async () => {
    responderCom({
      'INSERT INTO contract_notification_read': { rows: [{ id: 1 }, { id: 2 }] }
    })

    expect(await notifications.markAllRead(GESTOR)).toEqual({ marked: 2 })
  })

  it('ignora documento inativo', async () => {
    await notifications.markAllRead(GESTOR)

    const insercao = consultas.find((c) => c.texto.includes('INSERT INTO contract_notification_read'))
    expect(insercao.texto).toContain('d.active = true')
  })
})
