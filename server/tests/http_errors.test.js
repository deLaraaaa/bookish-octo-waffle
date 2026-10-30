import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const logger = require('../logger.js')
const { sendError, notFound, errorHandler, codeOf, statusOf } = require('../http_errors.js')

let res

beforeEach(() => {
  res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})

const corpo = () => res.json.mock.calls.at(-1)[0]
const status = () => res.status.mock.calls.at(-1)[0]

const erro = (campos) => Object.assign(new Error(campos.message || 'falhou'), campos)

describe('código do erro', () => {
  it('usa o code quando o erro é da aplicação', () => {
    expect(codeOf(erro({ status: 404, code: 'seal_not_found' }))).toBe('seal_not_found')
  })

  it('usa a mensagem quando não há code', () => {
    expect(codeOf(erro({ status: 400, message: 'invalid_cnpj' }))).toBe('invalid_cnpj')
  })

  it('traduz corpo JSON malformado', () => {
    expect(codeOf(erro({ status: 400, type: 'entity.parse.failed' }))).toBe('invalid_json')
  })

  it('traduz arquivo acima do limite', () => {
    expect(codeOf(erro({ code: 'LIMIT_FILE_SIZE' }))).toBe('file_too_large')
    expect(statusOf(erro({ code: 'LIMIT_FILE_SIZE' }))).toBe(413)
  })

  it('não vaza código do Postgres como se fosse de negócio', () => {
    const pg = erro({ code: '22P02', message: 'invalid input syntax for type uuid: "abc"' })

    expect(codeOf(pg)).toBe('internal_error')
    expect(statusOf(pg)).toBe(500)
  })

  it.each([
    ['sem erro', undefined],
    ['status fora da faixa', erro({ status: 999 })],
    ['status não numérico', erro({ status: 'quatrocentos' })]
  ])('cai no genérico para %s', (_rotulo, entrada) => {
    expect(codeOf(entrada)).toBe('internal_error')
  })
})

describe('sendError', () => {
  it('responde apenas com o código, nunca com a pilha', () => {
    sendError(res, erro({ status: 404, code: 'enterprise_not_found', stack: 'linha 1\nlinha 2' }))

    expect(status()).toBe(404)
    expect(corpo()).toEqual({ error: 'enterprise_not_found' })
    expect(JSON.stringify(corpo())).not.toContain('linha 1')
  })

  it('repassa details quando o erro traz', () => {
    sendError(res, erro({ status: 400, code: 'missing_variables', details: { missing: ['cnpj'] } }))

    expect(corpo()).toEqual({ error: 'missing_variables', details: { missing: ['cnpj'] } })
  })

  it('não inventa details quando não há', () => {
    sendError(res, erro({ status: 400, code: 'invalid_email' }))

    expect(corpo()).not.toHaveProperty('details')
  })

  it('erro inesperado vira genérico para o cliente e detalhado no log', () => {
    const pg = erro({ code: '22P02', message: 'invalid input syntax for type uuid: "abc"' })

    sendError(res, pg, { path: '/enterprises/abc/status' })

    expect(status()).toBe(500)
    expect(corpo()).toEqual({ error: 'internal_error' })
    expect(JSON.stringify(corpo())).not.toContain('uuid')

    const registrado = logger.error.mock.calls[0][1]
    expect(registrado.error).toContain('invalid input syntax')
    expect(registrado.path).toBe('/enterprises/abc/status')
  })

  it('erro de negócio não polui o log de erro', () => {
    sendError(res, erro({ status: 400, code: 'invalid_cnpj' }))

    expect(logger.error).not.toHaveBeenCalled()
  })

  it('falha de servidor é registrada mesmo com código próprio', () => {
    sendError(res, erro({ status: 503, code: 'azure_not_configured' }))

    expect(logger.error).toHaveBeenCalled()
  })
})

describe('rota inexistente', () => {
  it('responde 404 com código previsível', () => {
    notFound({ method: 'GET', path: '/nao-existe' }, res)

    expect(status()).toBe(404)
    expect(corpo()).toEqual({ error: 'route_not_found' })
  })
})

describe('middleware de erro', () => {
  it('converte falha de framework em resposta JSON', () => {
    const req = { method: 'POST', path: '/enterprises', requestId: 'req-1' }

    errorHandler(erro({ code: 'LIMIT_FILE_SIZE' }), req, res, () => {})

    expect(status()).toBe(413)
    expect(corpo()).toEqual({ error: 'file_too_large' })
  })

  it('JSON malformado vira código tratável pelo cliente', () => {
    const req = { method: 'POST', path: '/auth/onboarding' }

    errorHandler(erro({ status: 400, type: 'entity.parse.failed' }), req, res, () => {})

    expect(status()).toBe(400)
    expect(corpo()).toEqual({ error: 'invalid_json' })
  })

  it('registra o contexto da requisição no log', () => {
    const req = { method: 'GET', path: '/health', requestId: 'req-9' }

    errorHandler(erro({ message: 'conexão perdida' }), req, res, () => {})

    expect(logger.error.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      path: '/health',
      request_id: 'req-9'
    })
  })
})
