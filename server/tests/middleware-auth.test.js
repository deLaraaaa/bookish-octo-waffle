import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const tokens = require('../auth/jwt.js')
const { requireAuth, requireRole } = require('../middleware/auth.js')

const PESSOA = { uuid: 'p-1', full_name: 'Rafael' }
const EMAIL = 'ra.cardoso@catolicasc.edu.br'

let res
let next

beforeEach(() => {
  res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  next = vi.fn()
})

const comHeader = (authorization) => ({ headers: authorization ? { authorization } : {} })

function esperaRecusa(status, erro) {
  expect(next).not.toHaveBeenCalled()
  expect(res.status).toHaveBeenCalledWith(status)
  expect(res.json).toHaveBeenCalledWith({ error: erro })
}

describe('requireAuth', () => {
  it('libera requisição com token de sessão válido', () => {
    const req = comHeader(`Bearer ${tokens.signSession(PESSOA, 'MANAGER', EMAIL)}`)

    requireAuth(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
    expect(req.user.sub).toBe('p-1')
    expect(req.user.role).toBe('MANAGER')
  })

  it('aceita o esquema Bearer em qualquer caixa', () => {
    requireAuth(comHeader(`bEaReR ${tokens.signSession(PESSOA, 'ADMIN', EMAIL)}`), res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it.each([
    ['sem header', undefined],
    ['header vazio', ''],
    ['sem o esquema Bearer', 'abc.def.ghi'],
    ['com outro esquema', 'Basic dXNlcjpzZW5oYQ=='],
    ['Bearer sem token', 'Bearer ']
  ])('recusa requisição %s', (_rotulo, authorization) => {
    requireAuth(comHeader(authorization), res, next)
    esperaRecusa(401, 'missing_token')
  })

  it('recusa token de desafio 2FA usado como sessão', () => {
    const desafio = tokens.signChallenge({ uuid: 'i-1', email: EMAIL })

    requireAuth(comHeader(`Bearer ${desafio}`), res, next)

    esperaRecusa(401, 'invalid_token')
  })

  it('recusa state do OAuth usado como sessão', () => {
    requireAuth(comHeader(`Bearer ${tokens.signState({ redirect: '/' })}`), res, next)
    esperaRecusa(401, 'invalid_token')
  })

  it('recusa token expirado', () => {
    const vencido = tokens.signSession(PESSOA, 'ADMIN', EMAIL, { expiresIn: '-1s' })

    requireAuth(comHeader(`Bearer ${vencido}`), res, next)

    esperaRecusa(401, 'invalid_token')
  })

  it('recusa token com assinatura inválida', () => {
    const token = tokens.signSession(PESSOA, 'ADMIN', EMAIL)

    requireAuth(comHeader(`Bearer ${token.slice(0, -2)}xx`), res, next)

    esperaRecusa(401, 'invalid_token')
  })

  it('não expõe o motivo interno da falha ao cliente', () => {
    requireAuth(comHeader('Bearer nao-e-um-jwt'), res, next)

    expect(res.json).toHaveBeenCalledWith({ error: 'invalid_token' })
    expect(JSON.stringify(res.json.mock.calls)).not.toMatch(/jwt|malformed|secret/i)
  })
})

describe('requireRole', () => {
  it('libera quando o papel está na lista', () => {
    requireRole('MANAGER', 'ADMIN')({ user: { role: 'ADMIN' } }, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('recusa papel fora da lista', () => {
    requireRole('ADMIN')({ user: { role: 'MANAGER' } }, res, next)
    esperaRecusa(403, 'forbidden')
  })

  it('recusa requisição sem usuário autenticado', () => {
    requireRole('ADMIN')({}, res, next)
    esperaRecusa(403, 'forbidden')
  })

  it('recusa usuário sem papel definido', () => {
    requireRole('ADMIN')({ user: {} }, res, next)
    esperaRecusa(403, 'forbidden')
  })

  it('sem papéis informados, recusa qualquer um', () => {
    requireRole()({ user: { role: 'ADMIN' } }, res, next)
    esperaRecusa(403, 'forbidden')
  })

  it('compara o papel respeitando a caixa', () => {
    requireRole('ADMIN')({ user: { role: 'admin' } }, res, next)
    esperaRecusa(403, 'forbidden')
  })
})
