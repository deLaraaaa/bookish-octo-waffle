import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nodemailer = require('nodemailer')
const logger = require('../logger.js')
const graph = require('../services/graph.js')
const graphToken = require('../services/graphToken.js')

const DESTINO = 'ra.cardoso@catolicasc.edu.br'
const CODIGO = '4821'

const TRANSPORTE_ORIGINAL = process.env.MAIL_TRANSPORT
const AMBIENTE_ORIGINAL = process.env.NODE_ENV
const SMTP_ORIGINAL = process.env.SMTP_HOST

let enviarGraph
let token
let enviarSmtp

function carregar({ transporte = 'auto', producao = false, comSmtp = false } = {}) {
  process.env.MAIL_TRANSPORT = transporte
  process.env.NODE_ENV = producao ? 'production' : 'test'
  if (comSmtp) process.env.SMTP_HOST = 'smtp.exemplo.com'
  else delete process.env.SMTP_HOST

  delete require.cache[require.resolve('../auth/email.js')]
  return require('../auth/email.js')
}

beforeEach(() => {
  enviarGraph = vi.spyOn(graph, 'sendMail').mockResolvedValue(null)
  enviarSmtp = vi.fn().mockResolvedValue({ accepted: [DESTINO] })
  vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail: enviarSmtp })
  token = vi.spyOn(graphToken, 'accessTokenForEmail').mockResolvedValue('tok-graph')
  vi.spyOn(logger, 'info').mockImplementation(() => {})
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env.MAIL_TRANSPORT = TRANSPORTE_ORIGINAL
  process.env.NODE_ENV = AMBIENTE_ORIGINAL
  if (SMTP_ORIGINAL === undefined) delete process.env.SMTP_HOST
  else process.env.SMTP_HOST = SMTP_ORIGINAL
  delete require.cache[require.resolve('../auth/email.js')]
})

describe('envio pelo Microsoft Graph', () => {
  it('é o caminho preferido quando o transporte é automático', async () => {
    const email = carregar()

    expect(await email.sendVerificationCode(DESTINO, CODIGO)).toEqual({
      delivered: true,
      via: 'graph'
    })
    expect(token).toHaveBeenCalledWith(DESTINO)
  })

  it('envia para o próprio usuário, com o código no corpo', async () => {
    const email = carregar()

    await email.sendVerificationCode(DESTINO, CODIGO)

    const [tokenUsado, mensagem] = enviarGraph.mock.calls[0]
    expect(tokenUsado).toBe('tok-graph')
    expect(mensagem.to).toBe(DESTINO)
    expect(mensagem.subject).toContain('verificação')
    expect(mensagem.html).toContain(CODIGO)
    expect(mensagem.text).toContain(CODIGO)
  })

  it('não depende de SMTP configurado', async () => {
    const email = carregar({ comSmtp: false })

    expect((await email.sendVerificationCode(DESTINO, CODIGO)).delivered).toBe(true)
  })

  it('registra por qual caminho o código saiu', async () => {
    const email = carregar()

    await email.sendVerificationCode(DESTINO, CODIGO)

    expect(logger.info).toHaveBeenCalledWith('two_factor_code_sent', { to: DESTINO, via: 'graph' })
  })
})

describe('queda para SMTP', () => {
  it('tenta o SMTP quando o Graph falha', async () => {
    token.mockRejectedValue(new Error('onedrive_not_connected'))
    const email = carregar({ comSmtp: true })

    const r = await email.sendVerificationCode(DESTINO, CODIGO)

    expect(r.via).toBe('smtp')
    expect(enviarSmtp).toHaveBeenCalledOnce()
    expect(enviarSmtp.mock.calls[0][0].to).toBe(DESTINO)
    expect(logger.warn).toHaveBeenCalledWith(
      'two_factor_code_send_failed',
      expect.objectContaining({ via: 'graph' })
    )
  })

  it('sem SMTP configurado, a queda também falha', async () => {
    token.mockRejectedValue(new Error('onedrive_not_connected'))
    const email = carregar({ comSmtp: false })

    expect((await email.sendVerificationCode(DESTINO, CODIGO)).delivered).toBe(false)
  })
})

describe('transporte fixado por configuração', () => {
  it('graph não tenta SMTP mesmo falhando', async () => {
    token.mockRejectedValue(new Error('sem token'))
    const email = carregar({ transporte: 'graph', comSmtp: true })

    const r = await email.sendVerificationCode(DESTINO, CODIGO)

    expect(r.delivered).toBe(false)
    expect(r.error).not.toContain('smtp')
  })

  it('smtp não chama o Graph', async () => {
    const email = carregar({ transporte: 'smtp', comSmtp: false })

    await email.sendVerificationCode(DESTINO, CODIGO)

    expect(enviarGraph).not.toHaveBeenCalled()
  })
})

describe('quando nada entrega', () => {
  beforeEach(() => {
    token.mockRejectedValue(new Error('sem token'))
  })

  it('fora de produção, mostra o código no log para destravar o desenvolvimento', async () => {
    const email = carregar({ producao: false })

    const r = await email.sendVerificationCode(DESTINO, CODIGO)

    expect(r.dev).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith('two_factor_code_dev', { to: DESTINO, code: CODIGO })
  })

  it('em produção, nunca escreve o código no log', async () => {
    const email = carregar({ producao: true })

    const r = await email.sendVerificationCode(DESTINO, CODIGO)

    expect(r.delivered).toBe(false)
    expect(r.dev).toBeUndefined()

    const tudoQueFoiLogado = JSON.stringify([
      ...logger.warn.mock.calls,
      ...logger.error.mock.calls,
      ...logger.info.mock.calls
    ])
    expect(tudoQueFoiLogado).not.toContain(CODIGO)
    expect(logger.error).toHaveBeenCalledWith(
      'two_factor_code_undelivered',
      expect.objectContaining({ to: DESTINO })
    )
  })

  it('reúne o motivo de cada tentativa', async () => {
    const email = carregar({ comSmtp: false })

    const r = await email.sendVerificationCode(DESTINO, CODIGO)

    expect(r.error).toContain('graph:')
    expect(r.error).toContain('smtp:')
  })
})
