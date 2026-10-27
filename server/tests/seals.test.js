import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const seals = require('../services/seals.js')

const ATOR = 'p-1'

let leitura
let listas
let read
let list
let create

beforeEach(() => {
  leitura = { seal: null, file_resource: null }
  listas = { seal: [], file_resource: [] }

  read = vi.spyOn(crud, 'read').mockImplementation(async (tabela) => leitura[tabela] || null)
  list = vi.spyOn(crud, 'list').mockImplementation(async (tabela) => listas[tabela] || [])
  create = vi.spyOn(crud, 'create').mockImplementation(async (tabela) => {
    if (tabela === 'file_resource') return { id: 60 }
    return { uuid: 's-1', name: 'Chancela da Reitoria' }
  })
})

const criacaoDe = (tabela) => create.mock.calls.find((c) => c[0] === tabela)

describe('create', () => {
  it('guarda o arquivo com o prefixo do OneDrive e cria a chancela', async () => {
    const resultado = await seals.create(ATOR, { itemId: 'i-1', name: 'Chancela da Reitoria' })

    expect(criacaoDe('file_resource')[1]).toEqual({
      name: 'Chancela da Reitoria',
      status: 'uploaded',
      file_path: 'onedrive:i-1'
    })
    expect(criacaoDe('seal')[1]).toEqual({
      name: 'Chancela da Reitoria',
      file_resource_id: 60
    })
    expect(resultado).toEqual({ uuid: 's-1', name: 'Chancela da Reitoria', itemId: 'i-1' })
  })

  it('usa rótulos padrão quando o nome não é informado', async () => {
    await seals.create(ATOR, { itemId: 'i-1' })

    expect(criacaoDe('file_resource')[1].name).toBe('chancela')
    expect(criacaoDe('seal')[1].name).toBe('Chancela')
  })
})

describe('list', () => {
  it('devolve vazio quando não há chancela', async () => {
    expect(await seals.list(ATOR)).toEqual([])
  })

  it('não consulta arquivos quando nenhuma chancela aponta para um', async () => {
    listas.seal = [{ uuid: 's-1', name: 'Chancela', file_resource_id: null }]

    expect(await seals.list(ATOR)).toEqual([])
    expect(list.mock.calls.some((c) => c[0] === 'file_resource')).toBe(false)
  })

  it('traduz o caminho do arquivo no itemId do OneDrive', async () => {
    listas.seal = [{ uuid: 's-1', name: 'Reitoria', file_resource_id: 60 }]
    listas.file_resource = [{ id: 60, file_path: 'onedrive:i-1' }]

    expect(await seals.list(ATOR)).toEqual([{ uuid: 's-1', name: 'Reitoria', itemId: 'i-1' }])
  })

  it('esconde chancela cujo arquivo não está no OneDrive', async () => {
    listas.seal = [
      { uuid: 's-1', name: 'Boa', file_resource_id: 60 },
      { uuid: 's-2', name: 'Órfã', file_resource_id: 61 }
    ]
    listas.file_resource = [
      { id: 60, file_path: 'onedrive:i-1' },
      { id: 61, file_path: '/disco/local/selo.png' }
    ]

    expect((await seals.list(ATOR)).map((s) => s.name)).toEqual(['Boa'])
  })

  it('traz só as ativas, em ordem de nome', async () => {
    await seals.list(ATOR)

    const opcoes = list.mock.calls[0][1]
    expect(opcoes.where).toEqual({ active: true })
    expect(opcoes.orderBy).toBe('name')
  })
})

describe('itemIdForUuid', () => {
  it('recusa chancela inexistente', async () => {
    await expect(seals.itemIdForUuid(ATOR, 's-9')).rejects.toMatchObject({
      status: 404,
      code: 'seal_not_found'
    })
  })

  it('procura apenas entre as chancelas ativas', async () => {
    leitura.seal = { file_resource_id: 60 }
    leitura.file_resource = { file_path: 'onedrive:i-1' }

    await seals.itemIdForUuid(ATOR, 's-1')

    expect(read.mock.calls[0][1].where).toEqual({ uuid: 's-1', active: true })
  })

  it('recusa quando o arquivo da chancela sumiu', async () => {
    leitura.seal = { file_resource_id: 60 }
    leitura.file_resource = null

    await expect(seals.itemIdForUuid(ATOR, 's-1')).rejects.toMatchObject({
      status: 404,
      code: 'seal_file_not_found'
    })
  })

  it('recusa arquivo que não está no OneDrive', async () => {
    leitura.seal = { file_resource_id: 60 }
    leitura.file_resource = { file_path: '/disco/local/selo.png' }

    await expect(seals.itemIdForUuid(ATOR, 's-1')).rejects.toMatchObject({
      status: 404,
      code: 'seal_file_not_found'
    })
  })

  it('devolve o itemId sem o prefixo', async () => {
    leitura.seal = { file_resource_id: 60 }
    leitura.file_resource = { file_path: 'onedrive:01ABCXYZ' }

    expect(await seals.itemIdForUuid(ATOR, 's-1')).toBe('01ABCXYZ')
  })
})
