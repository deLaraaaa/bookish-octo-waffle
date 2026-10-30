import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)
const logger = require('../logger.js')
const httpLogs = require('../http_logs.js')

let middleware
let next

beforeEach(() => {
  vi.spyOn(logger, 'info').mockImplementation(() => {})
  middleware = httpLogs()
  next = vi.fn()
})

function requisicao(headers = {}) {
  return {
    headers,
    method: 'GET',
    path: '/enterprises',
    originalUrl: '/enterprises?page=2',
    ip: '10.0.0.1'
  }
}

function resposta(statusCode = 200) {
  const res = new EventEmitter()
  res.statusCode = statusCode
  res.setHeader = vi.fn()
  return res
}

const registro = () => logger.info.mock.calls.at(-1)[1]

describe('httpLogs', () => {
  it('gera um identificador quando a requisição não traz um', () => {
    const req = requisicao()

    middleware(req, resposta(), next)

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(next).toHaveBeenCalledOnce()
  })

  it('reaproveita o identificador enviado pelo cliente', () => {
    const req = requisicao({ 'x-request-id': 'req-externo-1' })

    middleware(req, resposta(), next)

    expect(req.requestId).toBe('req-externo-1')
  })

  it('devolve o identificador no cabeçalho da resposta', () => {
    const req = requisicao({ 'x-request-id': 'req-1' })
    const res = resposta()

    middleware(req, res, next)

    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'req-1')
  })

  it('só registra o acesso quando a resposta termina', () => {
    const res = resposta()

    middleware(requisicao(), res, next)
    expect(logger.info).not.toHaveBeenCalled()

    res.emit('finish')
    expect(logger.info).toHaveBeenCalledWith('http_request', expect.any(Object))
  })

  it('registra método, caminho, status e o identificador', () => {
    const req = requisicao({ 'x-request-id': 'req-1', 'user-agent': 'vitest' })
    const res = resposta(404)

    middleware(req, res, next)
    res.emit('finish')

    expect(registro()).toMatchObject({
      request_id: 'req-1',
      method: 'GET',
      path: '/enterprises',
      status: 404,
      ip: '10.0.0.1',
      user_agent: 'vitest'
    })
  })

  it('mede a duração em milissegundos com duas casas', () => {
    const res = resposta()

    middleware(requisicao(), res, next)
    res.emit('finish')

    const { duration_ms } = registro()
    expect(typeof duration_ms).toBe('number')
    expect(duration_ms).toBeGreaterThanOrEqual(0)
    expect(String(duration_ms).split('.')[1]?.length || 0).toBeLessThanOrEqual(2)
  })

  it('não registra a query string, que pode conter credencial', () => {
    const req = requisicao({ 'x-request-id': 'req-1' })
    req.path = '/auth/microsoft/callback'
    req.originalUrl = '/auth/microsoft/callback?code=SEGREDO&state=jwt'
    const res = resposta()

    middleware(req, res, next)
    res.emit('finish')

    expect(registro().path).toBe('/auth/microsoft/callback')
    expect(JSON.stringify(registro())).not.toContain('SEGREDO')
  })

  it('cada requisição recebe um identificador próprio', () => {
    const a = requisicao()
    const b = requisicao()

    middleware(a, resposta(), next)
    middleware(b, resposta(), next)

    expect(a.requestId).not.toBe(b.requestId)
  })
})
