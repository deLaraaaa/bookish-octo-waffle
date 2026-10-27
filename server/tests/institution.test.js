import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const institution = require('../services/institution.js')

let list

beforeEach(() => {
  list = vi.spyOn(crud, 'list').mockResolvedValue([])
})

describe('list', () => {
  it('traz só as instituições ativas, em ordem alfabética', async () => {
    await institution.list({ sub: 'p-1' })

    const [tabela, opcoes] = list.mock.calls[0]
    expect(tabela).toBe('institution')
    expect(opcoes.select).toEqual(['id', 'uuid', 'name'])
    expect(opcoes.where).toEqual({ active: true })
    expect(opcoes.orderBy).toEqual([{ column: 'name', direction: 'ASC' }])
  })

  it('consulta como o usuário informado', async () => {
    const usuario = { sub: 'p-1' }
    await institution.list(usuario)
    expect(list.mock.calls[0][3]).toBe(usuario)
  })

  it('sem usuário, consulta como o usuário de sistema', async () => {
    await institution.list(null)
    expect(list.mock.calls[0][3]).toBe('system:app')
  })

  it('devolve as linhas encontradas', async () => {
    const linhas = [{ id: 1, uuid: 'i-1', name: 'Jaraguá do Sul' }]
    list.mockResolvedValue(linhas)

    expect(await institution.list({ sub: 'p-1' })).toEqual(linhas)
  })
})
