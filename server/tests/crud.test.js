import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const db = require('../db.js')
const crud = require('../crud.js')

const USER = 'tests@catolicasc.edu.br'

let query

beforeEach(() => {
  query = vi.spyOn(db, 'query').mockResolvedValue({ rows: [], rowCount: 0 })
})

function lastSql() {
  return query.mock.calls.at(-1)[0].replace(/\s+/g, ' ').trim()
}
function lastValues() {
  return query.mock.calls.at(-1)[1]
}

describe('usuário obrigatório', () => {
  const chamadas = {
    create: () => crud.create('role', { name: 'X' }, {}, undefined),
    read: () => crud.read('role', {}, null, undefined),
    list: () => crud.list('role', {}, null, undefined),
    update: () => crud.update('role', { name: 'X' }, { where: { id: 1 } }, undefined),
    remove: () => crud.remove('role', { where: { id: 1 } }, undefined),
    upcreate: () => crud.upcreate('role', { name: 'X' }, { columns: ['name'] }, {}, undefined)
  }

  for (const [nome, chamar] of Object.entries(chamadas)) {
    it(`${nome} recusa chamada sem user`, async () => {
      await expect(chamar()).rejects.toThrow(`${nome}: user is required`)
      expect(query).not.toHaveBeenCalled()
    })
  }
})

describe('allowlist de tabelas', () => {
  it('recusa tabela fora do allowlist', async () => {
    await expect(crud.list('usuarios_secretos', {}, null, USER)).rejects.toThrow(
      'Table not allowed: usuarios_secretos'
    )
  })

  it('recusa nome de tabela com SQL embutido', async () => {
    await expect(crud.list('role; DROP TABLE role', {}, null, USER)).rejects.toThrow(/Invalid table/)
  })

  it('recusa tabela maiúscula (o allowlist é case-sensitive)', async () => {
    await expect(crud.list('Role', {}, null, USER)).rejects.toThrow(/Invalid table/)
  })

  it('recusa tabela não-string', async () => {
    await expect(crud.list(null, {}, null, USER)).rejects.toThrow(/Invalid table/)
  })

  it('recusa chave herdada do prototype como tabela', async () => {
    await expect(crud.list('constructor', {}, null, USER)).rejects.toThrow('Table not allowed: constructor')
    await expect(crud.list('__proto__', {}, null, USER)).rejects.toThrow('Table not allowed: __proto__')
  })

  it('SCHEMA é congelado: ninguém adiciona tabela em runtime', () => {
    expect(Object.isFrozen(crud.SCHEMA)).toBe(true)
    expect(() => {
      'use strict'
      crud.SCHEMA.tabela_nova = ['id']
    }).toThrow()
    expect(crud.SCHEMA.tabela_nova).toBeUndefined()
  })
})

describe('allowlist de colunas', () => {
  it('recusa coluna inexistente no select', async () => {
    await expect(crud.list('role', { select: ['senha'] }, null, USER)).rejects.toThrow(
      'Column not allowed: role.senha'
    )
  })

  it('recusa coluna com SQL embutido no where', async () => {
    await expect(
      crud.list('role', { where: { 'name) OR 1=1 --': 'x' } }, null, USER)
    ).rejects.toThrow(/Invalid column/)
  })

  it('recusa coluna de outra tabela', async () => {
    await expect(crud.list('role', { select: ['cnpj'] }, null, USER)).rejects.toThrow(
      'Column not allowed: role.cnpj'
    )
  })

  it('recusa select que não é array', async () => {
    await expect(crud.list('role', { select: 'name' }, null, USER)).rejects.toThrow(
      'Columns must be an array'
    )
  })

  it('recusa coluna inexistente no orderBy', async () => {
    await expect(crud.list('role', { orderBy: 'inexistente' }, null, USER)).rejects.toThrow(
      'Column not allowed: role.inexistente'
    )
  })
})

describe('create', () => {
  it('parametriza todos os valores e devolve a linha criada', async () => {
    query.mockResolvedValue({ rows: [{ id: 1, name: 'MANAGER' }], rowCount: 1 })

    const row = await crud.create('role', { name: 'MANAGER', active: true }, {}, USER)

    expect(lastSql()).toBe('INSERT INTO role (name, active) VALUES ($1, $2) RETURNING *')
    expect(lastValues()).toEqual(['MANAGER', true])
    expect(row).toEqual({ id: 1, name: 'MANAGER' })
  })

  it('ignora chaves com valor undefined', async () => {
    await crud.create('role', { name: 'X', active: undefined }, {}, USER)

    expect(lastSql()).toBe('INSERT INTO role (name) VALUES ($1) RETURNING *')
    expect(lastValues()).toEqual(['X'])
  })

  it('recusa data vazia', async () => {
    await expect(crud.create('role', {}, {}, USER)).rejects.toThrow('create: data is empty')
    await expect(crud.create('role', { name: undefined }, {}, USER)).rejects.toThrow('create: data is empty')
  })

  it('returning: false omite RETURNING e devolve rowCount', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })

    const out = await crud.create('role', { name: 'X' }, { returning: false }, USER)

    expect(lastSql()).toBe('INSERT INTO role (name) VALUES ($1)')
    expect(out).toEqual({ rowCount: 1 })
  })

  it('valida as colunas pedidas em returning', async () => {
    await expect(crud.create('role', { name: 'X' }, { returning: ['senha'] }, USER)).rejects.toThrow(
      'Column not allowed: role.senha'
    )
  })

  it('valor malicioso viaja como parâmetro, nunca como SQL', async () => {
    const ataque = "'; DROP TABLE role; --"

    await crud.create('role', { name: ataque }, {}, USER)

    expect(lastSql()).not.toContain('DROP')
    expect(lastValues()).toEqual([ataque])
  })
})

describe('read', () => {
  it('monta SELECT com LIMIT 1 e devolve a primeira linha', async () => {
    query.mockResolvedValue({ rows: [{ id: 7 }], rowCount: 1 })

    const row = await crud.read('role', { select: ['id', 'name'], where: { id: 7 } }, null, USER)

    expect(lastSql()).toBe('SELECT id, name FROM role WHERE id = $1 LIMIT 1')
    expect(lastValues()).toEqual([7])
    expect(row).toEqual({ id: 7 })
  })

  it('devolve null quando não há linha', async () => {
    expect(await crud.read('role', { where: { id: 999 } }, null, USER)).toBeNull()
  })

  it('sem select, traz todas as colunas', async () => {
    await crud.read('role', { where: { id: 1 } }, null, USER)
    expect(lastSql()).toContain('SELECT * FROM role')
  })
})

describe('list', () => {
  it('aplica orderBy, limit e offset', async () => {
    await crud.list(
      'role',
      { orderBy: [{ column: 'insert_date', direction: 'desc' }, 'name'], limit: 10, offset: 20 },
      null,
      USER
    )

    expect(lastSql()).toBe('SELECT * FROM role ORDER BY insert_date DESC, name ASC LIMIT 10 OFFSET 20')
  })

  it('devolve o array de linhas', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
    expect(await crud.list('role', {}, null, USER)).toEqual([{ id: 1 }, { id: 2 }])
  })

  it.each([
    ['negativo', -1],
    ['fracionário', 1.5],
    ['não numérico', 'dez'],
    ['SQL', '1; DROP TABLE role']
  ])('recusa limit %s', async (_rotulo, valor) => {
    await expect(crud.list('role', { limit: valor }, null, USER)).rejects.toThrow(/Invalid limit/)
  })

  it('recusa offset inválido', async () => {
    await expect(crud.list('role', { offset: -5 }, null, USER)).rejects.toThrow(/Invalid offset/)
  })

  it('aceita limit numérico em string', async () => {
    await crud.list('role', { limit: '10' }, null, USER)
    expect(lastSql()).toContain('LIMIT 10')
  })

  it('recusa direção de ordenação inválida', async () => {
    await expect(
      crud.list('role', { orderBy: { column: 'name', direction: 'ASC; DROP TABLE role' } }, null, USER)
    ).rejects.toThrow(/Invalid order direction/)
  })
})

describe('operadores do WHERE', () => {
  it('valor direto vira igualdade parametrizada', async () => {
    await crud.list('enterprise', { where: { city: 'Jaraguá do Sul' } }, null, USER)
    expect(lastSql()).toContain('WHERE city = $1')
    expect(lastValues()).toEqual(['Jaraguá do Sul'])
  })

  it('null vira IS NULL sem parâmetro', async () => {
    await crud.list('role_invite', { where: { consumed_at: null } }, null, USER)
    expect(lastSql()).toContain('WHERE consumed_at IS NULL')
    expect(lastValues()).toEqual([])
  })

  it('is_null e is_not_null não consomem parâmetro', async () => {
    await crud.list(
      'role_invite',
      { where: { consumed_at: { op: 'is_null' }, email: { op: 'is_not_null' } } },
      null,
      USER
    )
    expect(lastSql()).toContain('WHERE consumed_at IS NULL AND email IS NOT NULL')
    expect(lastValues()).toEqual([])
  })

  it('in vira = ANY($n) com o array como parâmetro', async () => {
    await crud.list('document', { where: { id: { op: 'in', value: [1, 2, 3] } } }, null, USER)
    expect(lastSql()).toContain('WHERE id = ANY($1)')
    expect(lastValues()).toEqual([[1, 2, 3]])
  })

  it('in recusa array vazio', async () => {
    await expect(
      crud.list('document', { where: { id: { op: 'in', value: [] } } }, null, USER)
    ).rejects.toThrow('IN requires a non-empty array for id')
  })

  it('like e ilike sobem para maiúsculo no SQL', async () => {
    await crud.list(
      'audit_log',
      { where: { actor_email: { op: 'ilike', value: '%ra.card%' }, action: { op: 'like', value: 'manager.%' } } },
      null,
      USER
    )
    expect(lastSql()).toContain('actor_email ILIKE $1')
    expect(lastSql()).toContain('action LIKE $2')
    expect(lastValues()).toEqual(['%ra.card%', 'manager.%'])
  })

  it('array de condições na mesma coluna vira intervalo com AND', async () => {
    const de = new Date('2026-10-01T00:00:00Z')
    const ate = new Date('2026-10-27T00:00:00Z')

    await crud.list(
      'audit_log',
      { where: { insert_date: [{ op: '>=', value: de }, { op: '<', value: ate }] } },
      null,
      USER
    )

    expect(lastSql()).toContain('WHERE insert_date >= $1 AND insert_date < $2')
    expect(lastValues()).toEqual([de, ate])
  })

  it('recusa operador fora do conjunto permitido', async () => {
    await expect(
      crud.list('role', { where: { name: { op: 'similar to', value: 'x' } } }, null, USER)
    ).rejects.toThrow('Operator not allowed: similar to')
  })

  it('condição undefined não gera cláusula', async () => {
    await crud.list('role', { where: { name: undefined } }, null, USER)
    expect(lastSql()).toBe('SELECT * FROM role')
  })
})

describe('filtros no formato AndFilters (legado)', () => {
  it('traduz igualdade, in e is null', async () => {
    await crud.list(
      'enterprise',
      {},
      {
        AndFilters: [
          ['status', '=', 'active'],
          ['id', 'in', [1, 2]],
          ['contact_email', 'is null']
        ]
      },
      USER
    )

    expect(lastSql()).toContain('WHERE status = $1 AND id = ANY($2) AND contact_email IS NULL')
    expect(lastValues()).toEqual(['active', [1, 2]])
  })

  it('aceita a grafia andFilters', async () => {
    await crud.list('role', {}, { andFilters: [['name', '=', 'ADMIN']] }, USER)
    expect(lastSql()).toContain('WHERE name = $1')
  })

  it('opts.where tem precedência sobre AndFilters', async () => {
    await crud.list('role', { where: { id: 1 } }, { AndFilters: [['name', '=', 'ADMIN']] }, USER)
    expect(lastSql()).toContain('WHERE id = $1')
    expect(lastValues()).toEqual([1])
  })

  it('operador omitido assume igualdade', async () => {
    await crud.list('role', {}, { AndFilters: [['name', '=', 'ADMIN']] }, USER)
    expect(lastValues()).toEqual(['ADMIN'])
  })

  it('recusa AndFilters que não é array', async () => {
    await expect(crud.list('role', {}, { AndFilters: 'name=ADMIN' }, USER)).rejects.toThrow(
      'AndFilters must be an array'
    )
  })

  it('recusa item malformado', async () => {
    await expect(crud.list('role', {}, { AndFilters: [['name']] }, USER)).rejects.toThrow(
      /Invalid AndFilters item/
    )
  })

  it('recusa operador não permitido', async () => {
    await expect(crud.list('role', {}, { AndFilters: [['name', 'similar to', 'x']] }, USER)).rejects.toThrow(
      /Operator not allowed/
    )
  })

  it('recusa coluna fora do allowlist', async () => {
    await expect(crud.list('role', {}, { AndFilters: [['senha', '=', 'x']] }, USER)).rejects.toThrow(
      'Column not allowed: role.senha'
    )
  })
})

describe('update', () => {
  it('numera os placeholders do WHERE depois dos do SET', async () => {
    query.mockResolvedValue({ rows: [{ uuid: 'u1', status: 'active' }], rowCount: 1 })

    const rows = await crud.update(
      'enterprise',
      { status: 'active', city: 'Joinville' },
      { where: { uuid: 'u1' }, returning: ['uuid', 'status'] },
      USER
    )

    expect(lastSql()).toBe(
      'UPDATE enterprise SET status = $1, city = $2 WHERE uuid = $3 RETURNING uuid, status'
    )
    expect(lastValues()).toEqual(['active', 'Joinville', 'u1'])
    expect(rows).toEqual([{ uuid: 'u1', status: 'active' }])
  })

  it('recusa update sem where', async () => {
    await expect(crud.update('enterprise', { status: 'active' }, {}, USER)).rejects.toThrow(
      'update: opts.where is required'
    )
    expect(query).not.toHaveBeenCalled()
  })

  it('recusa where vazio', async () => {
    await expect(
      crud.update('enterprise', { status: 'active' }, { where: {} }, USER)
    ).rejects.toThrow('update: opts.where is required')
  })

  it('recusa where que não produz condição alguma', async () => {
    await expect(
      crud.update('enterprise', { status: 'active' }, { where: { uuid: undefined } }, USER)
    ).rejects.toThrow(/where/)
    expect(query).not.toHaveBeenCalled()
  })

  it('recusa patch vazio', async () => {
    await expect(crud.update('enterprise', {}, { where: { uuid: 'u1' } }, USER)).rejects.toThrow(
      'update: patch is empty'
    )
  })

  it('returning: false devolve rowCount', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 3 })

    const out = await crud.update(
      'enterprise',
      { status: 'active' },
      { where: { city: 'Joinville' }, returning: false },
      USER
    )

    expect(lastSql()).toBe('UPDATE enterprise SET status = $1 WHERE city = $2')
    expect(out).toEqual({ rowCount: 3 })
  })

  it('aceita opts.filters como apelido de opts.where', async () => {
    await crud.update('enterprise', { status: 'active' }, { filters: { uuid: 'u1' } }, USER)
    expect(lastSql()).toContain('WHERE uuid = $2')
  })
})

describe('remove', () => {
  it('monta DELETE parametrizado', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 })

    const rows = await crud.remove('role_invite', { where: { email: 'x@y.com' }, returning: ['id'] }, USER)

    expect(lastSql()).toBe('DELETE FROM role_invite WHERE email = $1 RETURNING id')
    expect(lastValues()).toEqual(['x@y.com'])
    expect(rows).toEqual([{ id: 1 }])
  })

  it('recusa delete sem where', async () => {
    await expect(crud.remove('role_invite', {}, USER)).rejects.toThrow('remove: opts.where is required')
    expect(query).not.toHaveBeenCalled()
  })

  it('recusa where que não produz condição alguma', async () => {
    await expect(
      crud.remove('role_invite', { where: { email: undefined } }, USER)
    ).rejects.toThrow(/where/)
    expect(query).not.toHaveBeenCalled()
  })

  it('returning: false devolve rowCount', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 2 })
    const out = await crud.remove('role_invite', { where: { active: false }, returning: false }, USER)
    expect(lastSql()).toBe('DELETE FROM role_invite WHERE active = $1')
    expect(out).toEqual({ rowCount: 2 })
  })
})

describe('upcreate', () => {
  it('monta ON CONFLICT por colunas e atualiza as colunas enviadas', async () => {
    query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 })

    const row = await crud.upcreate(
      'ms_oauth_token',
      { identity_id: 10, refresh_token: 'tok', scope: 'Files.ReadWrite' },
      { columns: ['identity_id'] },
      {},
      USER
    )

    expect(lastSql()).toBe(
      'INSERT INTO ms_oauth_token (identity_id, refresh_token, scope) VALUES ($1, $2, $3) ' +
        'ON CONFLICT (identity_id) DO UPDATE SET identity_id = EXCLUDED.identity_id, ' +
        'refresh_token = EXCLUDED.refresh_token, scope = EXCLUDED.scope RETURNING *'
    )
    expect(lastValues()).toEqual([10, 'tok', 'Files.ReadWrite'])
    expect(row).toEqual({ id: 1 })
  })

  it('aceita ON CONFLICT por constraint nomeada', async () => {
    await crud.upcreate('role_invite', { email: 'x@y.com', role_id: 2 }, { constraint: 'uq_role_invite_email' }, {}, USER)
    expect(lastSql()).toContain('ON CONFLICT ON CONSTRAINT uq_role_invite_email')
  })

  it('recusa nome de constraint com SQL embutido', async () => {
    await expect(
      crud.upcreate('role_invite', { email: 'x@y.com' }, { constraint: 'c; DROP TABLE role' }, {}, USER)
    ).rejects.toThrow(/Invalid constraint/)
  })

  it('exige columns ou constraint', async () => {
    await expect(crud.upcreate('role_invite', { email: 'x@y.com' }, {}, {}, USER)).rejects.toThrow(
      'upcreate: conflict.columns or conflict.constraint is required'
    )
    await expect(crud.upcreate('role_invite', { email: 'x@y.com' }, null, {}, USER)).rejects.toThrow(
      'upcreate: conflict.columns or conflict.constraint is required'
    )
  })

  it('updateColumns vazio vira DO NOTHING', async () => {
    await crud.upcreate(
      'role_invite',
      { email: 'x@y.com', role_id: 2 },
      { columns: ['email'] },
      { updateColumns: [] },
      USER
    )
    expect(lastSql()).toContain('DO NOTHING')
    expect(lastSql()).not.toContain('DO UPDATE')
  })

  it('updateColumns restringe o SET e é validado contra o allowlist', async () => {
    await crud.upcreate(
      'role_invite',
      { email: 'x@y.com', role_id: 2 },
      { columns: ['email'] },
      { updateColumns: ['role_id'] },
      USER
    )
    expect(lastSql()).toContain('DO UPDATE SET role_id = EXCLUDED.role_id')

    await expect(
      crud.upcreate('role_invite', { email: 'x@y.com' }, { columns: ['email'] }, { updateColumns: ['senha'] }, USER)
    ).rejects.toThrow('Column not allowed: role_invite.senha')
  })

  it('recusa data vazia', async () => {
    await expect(crud.upcreate('role_invite', {}, { columns: ['email'] }, {}, USER)).rejects.toThrow(
      'upcreate: data is empty'
    )
  })

  it('returning: false devolve rowCount', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const out = await crud.upcreate(
      'role_invite',
      { email: 'x@y.com' },
      { columns: ['email'] },
      { returning: false },
      USER
    )
    expect(out).toEqual({ rowCount: 1 })
  })

  it('devolve null quando o conflito resultou em DO NOTHING', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 })
    const row = await crud.upcreate(
      'role_invite',
      { email: 'x@y.com' },
      { columns: ['email'] },
      { updateColumns: [] },
      USER
    )
    expect(row).toBeNull()
  })
})
