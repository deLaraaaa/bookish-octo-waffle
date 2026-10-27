import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const jsonwebtoken = require('jsonwebtoken')
const tokens = require('../auth/jwt.js')

const PESSOA = { uuid: 'p-123', full_name: 'Rafael de Lara' }
const EMAIL = 'ra.cardoso@catolicasc.edu.br'

function duracao(token) {
  const { iat, exp } = jsonwebtoken.decode(token)
  return exp - iat
}

describe('signSession', () => {
  it('carrega identidade, papel e tipo da sessão', () => {
    const payload = tokens.verify(tokens.signSession(PESSOA, 'MANAGER', EMAIL))

    expect(payload.sub).toBe('p-123')
    expect(payload.email).toBe(EMAIL)
    expect(payload.name).toBe('Rafael de Lara')
    expect(payload.role).toBe('MANAGER')
    expect(payload.typ).toBe('session')
  })

  it('expira em 12 horas por padrão', () => {
    expect(duracao(tokens.signSession(PESSOA, 'ADMIN', EMAIL))).toBe(12 * 60 * 60)
  })

  it('aceita validade customizada', () => {
    expect(duracao(tokens.signSession(PESSOA, 'ADMIN', EMAIL, { expiresIn: '30m' }))).toBe(30 * 60)
  })
})

describe('signChallenge', () => {
  it('marca o token como desafio de 2FA e não carrega papel', () => {
    const payload = tokens.verify(tokens.signChallenge({ uuid: 'i-1', email: EMAIL }))

    expect(payload.typ).toBe('2fa_challenge')
    expect(payload.sub).toBe('i-1')
    expect(payload.email).toBe(EMAIL)
    expect(payload.role).toBeUndefined()
  })

  it('expira em 10 minutos por padrão', () => {
    expect(duracao(tokens.signChallenge({ uuid: 'i-1', email: EMAIL }))).toBe(10 * 60)
  })
})

describe('signState', () => {
  it('preserva o payload e marca como state do OAuth', () => {
    const payload = tokens.verify(tokens.signState({ redirect: '/manage' }))

    expect(payload.typ).toBe('oauth_state')
    expect(payload.redirect).toBe('/manage')
  })

  it('expira em 10 minutos', () => {
    expect(duracao(tokens.signState({}))).toBe(10 * 60)
  })

  it('aceita payload vazio', () => {
    expect(tokens.verify(tokens.signState()).typ).toBe('oauth_state')
  })
})

describe('verify', () => {
  it('recusa token de um tipo diferente do esperado', () => {
    const desafio = tokens.signChallenge({ uuid: 'i-1', email: EMAIL })

    expect(() => tokens.verify(desafio, 'session')).toThrow('Unexpected token type: 2fa_challenge')
  })

  it('recusa state do OAuth usado como sessão', () => {
    expect(() => tokens.verify(tokens.signState({}), 'session')).toThrow(/Unexpected token type/)
  })

  it('sem tipo esperado, aceita qualquer tipo', () => {
    expect(tokens.verify(tokens.signChallenge({ uuid: 'i-1', email: EMAIL })).typ).toBe('2fa_challenge')
  })

  it('recusa token adulterado', () => {
    const token = tokens.signSession(PESSOA, 'ADMIN', EMAIL)
    const [cabecalho, corpo, assinatura] = token.split('.')
    const forjado = JSON.parse(Buffer.from(corpo, 'base64url').toString())
    forjado.role = 'ADMIN'
    forjado.sub = 'outro'
    const corpoNovo = Buffer.from(JSON.stringify(forjado)).toString('base64url')

    expect(() => tokens.verify(`${cabecalho}.${corpoNovo}.${assinatura}`)).toThrow(/signature/i)
  })

  it('recusa token assinado com outro segredo', () => {
    const alheio = jsonwebtoken.sign({ sub: 'x', typ: 'session' }, 'outro-segredo')

    expect(() => tokens.verify(alheio)).toThrow(/signature/i)
  })

  it('recusa token expirado', () => {
    const vencido = tokens.signSession(PESSOA, 'ADMIN', EMAIL, { expiresIn: '-1s' })

    expect(() => tokens.verify(vencido)).toThrow(/expired/i)
  })

  it('recusa texto que não é um token', () => {
    expect(() => tokens.verify('nao-e-um-jwt')).toThrow()
  })
})
