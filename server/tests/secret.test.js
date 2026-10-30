import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { jwtSecret, TAMANHO_MINIMO } = require('../auth/secret.js')

const ORIGINAL = process.env.JWT_SECRET

afterEach(() => {
  process.env.JWT_SECRET = ORIGINAL
})

describe('jwtSecret', () => {
  it('devolve o segredo definido no ambiente', () => {
    process.env.JWT_SECRET = 'a'.repeat(48)
    expect(jwtSecret()).toBe('a'.repeat(48))
  })

  it('apara espaços nas pontas', () => {
    process.env.JWT_SECRET = `  ${'a'.repeat(40)}  `
    expect(jwtSecret()).toBe('a'.repeat(40))
  })

  it.each([
    ['ausente', undefined],
    ['vazia', ''],
    ['só espaços', '    ']
  ])('recusa variável %s', (_rotulo, valor) => {
    if (valor === undefined) delete process.env.JWT_SECRET
    else process.env.JWT_SECRET = valor

    expect(() => jwtSecret()).toThrow('JWT_SECRET não definida')
  })

  it('recusa segredo curto demais e informa o tamanho', () => {
    process.env.JWT_SECRET = 'curto'

    expect(() => jwtSecret()).toThrow(/curta demais: 5 caracteres/)
  })

  it('aceita exatamente o tamanho mínimo', () => {
    process.env.JWT_SECRET = 'x'.repeat(TAMANHO_MINIMO)

    expect(jwtSecret()).toHaveLength(TAMANHO_MINIMO)
  })

  it('recusa um caractere abaixo do mínimo', () => {
    process.env.JWT_SECRET = 'x'.repeat(TAMANHO_MINIMO - 1)

    expect(() => jwtSecret()).toThrow(/curta demais/)
  })

  it('a mensagem ensina a gerar um segredo válido', () => {
    delete process.env.JWT_SECRET

    expect(() => jwtSecret()).toThrow(/openssl rand -base64 48/)
  })

  it('nunca devolve um valor padrão embutido no código', () => {
    process.env.JWT_SECRET = 'b'.repeat(40)

    expect(jwtSecret()).not.toContain('insecure')
    expect(jwtSecret()).not.toContain('change-me')
  })
})

describe('módulos que assinam token', () => {
  const recarregar = (caminho) => {
    delete require.cache[require.resolve('../auth/secret.js')]
    delete require.cache[require.resolve(caminho)]
    return () => require(caminho)
  }

  const restaurar = (caminho) => {
    process.env.JWT_SECRET = ORIGINAL
    delete require.cache[require.resolve('../auth/secret.js')]
    delete require.cache[require.resolve(caminho)]
    require(caminho)
  }

  it.each([['../auth/jwt.js'], ['../auth/twofactor.js']])(
    '%s se recusa a carregar sem JWT_SECRET',
    (caminho) => {
      delete process.env.JWT_SECRET
      const carregar = recarregar(caminho)

      try {
        expect(carregar).toThrow(/JWT_SECRET/)
      } finally {
        restaurar(caminho)
      }
    }
  )

  it('jwt.js carrega normalmente com o segredo definido', () => {
    process.env.JWT_SECRET = 'c'.repeat(48)
    const carregar = recarregar('../auth/jwt.js')

    try {
      expect(typeof carregar().signSession).toBe('function')
    } finally {
      restaurar('../auth/jwt.js')
    }
  })
})
