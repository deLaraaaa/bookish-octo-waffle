import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)
const tokenCrypto = require('../auth/tokenCrypto.js')

const CHAVE_ORIGINAL = process.env.TOKEN_ENC_KEY

afterEach(() => {
  process.env.TOKEN_ENC_KEY = CHAVE_ORIGINAL
})

describe('encrypt e decrypt', () => {
  it('recupera o valor original', () => {
    const segredo = 'refresh-token-do-graph-abc123'
    expect(tokenCrypto.decrypt(tokenCrypto.encrypt(segredo))).toBe(segredo)
  })

  it('não deixa o texto original aparecer no pacote cifrado', () => {
    const segredo = 'refresh-token-do-graph-abc123'
    expect(tokenCrypto.encrypt(segredo)).not.toContain(segredo)
  })

  it('empacota iv, tag e texto cifrado em três partes base64', () => {
    const partes = tokenCrypto.encrypt('x').split(':')

    expect(partes).toHaveLength(3)
    for (const parte of partes) {
      expect(parte).toMatch(/^[A-Za-z0-9+/]+=*$/)
    }
    expect(Buffer.from(partes[0], 'base64')).toHaveLength(12)
    expect(Buffer.from(partes[1], 'base64')).toHaveLength(16)
  })

  it('gera pacotes diferentes para o mesmo valor', () => {
    expect(tokenCrypto.encrypt('mesmo-valor')).not.toBe(tokenCrypto.encrypt('mesmo-valor'))
  })

  it('preserva acentuação e caractere multibyte', () => {
    const valor = 'ação — Jaraguá do Sul 日本'
    expect(tokenCrypto.decrypt(tokenCrypto.encrypt(valor))).toBe(valor)
  })

  it('preserva string vazia', () => {
    expect(tokenCrypto.decrypt(tokenCrypto.encrypt(''))).toBe('')
  })

  it('converte valor não textual para string', () => {
    expect(tokenCrypto.decrypt(tokenCrypto.encrypt(12345))).toBe('12345')
    expect(tokenCrypto.decrypt(tokenCrypto.encrypt(null))).toBe('null')
  })
})

describe('integridade', () => {
  it('recusa pacote com texto cifrado adulterado', () => {
    const [iv, tag, ct] = tokenCrypto.encrypt('valor-original').split(':')
    const bytes = Buffer.from(ct, 'base64')
    bytes[0] ^= 0xff

    expect(() => tokenCrypto.decrypt([iv, tag, bytes.toString('base64')].join(':'))).toThrow()
  })

  it('recusa pacote com tag de autenticação adulterada', () => {
    const [iv, tag, ct] = tokenCrypto.encrypt('valor-original').split(':')
    const bytes = Buffer.from(tag, 'base64')
    bytes[0] ^= 0xff

    expect(() => tokenCrypto.decrypt([iv, bytes.toString('base64'), ct].join(':'))).toThrow()
  })

  it('recusa pacote cifrado com outra chave', () => {
    const pacote = tokenCrypto.encrypt('valor-original')
    process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64')

    expect(() => tokenCrypto.decrypt(pacote)).toThrow()
  })

  it('recusa pacote malformado', () => {
    expect(() => tokenCrypto.decrypt('sem-separadores')).toThrow()
    expect(() => tokenCrypto.decrypt('')).toThrow()
  })
})

describe('validação da chave', () => {
  it('aceita 32 bytes em base64', () => {
    process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString('base64')
    expect(tokenCrypto.decrypt(tokenCrypto.encrypt('ok'))).toBe('ok')
  })

  it('aceita 32 bytes em hexadecimal de 64 caracteres', () => {
    process.env.TOKEN_ENC_KEY = crypto.randomBytes(32).toString('hex')
    expect(tokenCrypto.decrypt(tokenCrypto.encrypt('ok'))).toBe('ok')
  })

  it('trata hex e base64 da mesma chave como a mesma chave', () => {
    const bruta = crypto.randomBytes(32)
    process.env.TOKEN_ENC_KEY = bruta.toString('hex')
    const pacote = tokenCrypto.encrypt('mesma-chave')

    process.env.TOKEN_ENC_KEY = bruta.toString('base64')
    expect(tokenCrypto.decrypt(pacote)).toBe('mesma-chave')
  })

  it.each([
    ['curta demais', crypto.randomBytes(16).toString('base64')],
    ['longa demais', crypto.randomBytes(64).toString('base64')],
    ['vazia', ''],
    ['hex de tamanho errado', crypto.randomBytes(31).toString('hex')]
  ])('recusa chave %s', (_rotulo, chave) => {
    process.env.TOKEN_ENC_KEY = chave
    expect(() => tokenCrypto.encrypt('x')).toThrow(/TOKEN_ENC_KEY/)
  })
})
