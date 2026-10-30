import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import crypto from 'node:crypto'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const email = require('../auth/email.js')
const twofactor = require('../auth/twofactor.js')

const IDENTITY = { id: 42, email: 'ra.cardoso@catolicasc.edu.br' }
const SYSTEM_USER = 'system:auth'

const hashDe = (codigo) =>
  crypto.createHash('sha256').update(`${codigo}:${process.env.JWT_SECRET}`).digest('hex')

const daquiA = (ms) => new Date(Date.now() + ms)

let create
let list
let update
let enviar

beforeEach(() => {
  create = vi.spyOn(crud, 'create').mockResolvedValue({ id: 1 })
  list = vi.spyOn(crud, 'list').mockResolvedValue([])
  update = vi.spyOn(crud, 'update').mockResolvedValue([{ id: 1 }])
  enviar = vi.spyOn(email, 'sendVerificationCode').mockResolvedValue({ delivered: true })
})

function registroGravado() {
  return create.mock.calls[0][1]
}

function codigoEnviado() {
  return enviar.mock.calls[0][1]
}

describe('issueCode', () => {
  it('envia um código de quatro dígitos para o e-mail da identidade', async () => {
    await twofactor.issueCode(IDENTITY)

    expect(enviar).toHaveBeenCalledOnce()
    expect(enviar.mock.calls[0][0]).toBe(IDENTITY.email)
    expect(codigoEnviado()).toMatch(/^\d{4}$/)
  })

  it('grava o hash do código, nunca o código em claro', async () => {
    await twofactor.issueCode(IDENTITY)

    const registro = registroGravado()
    expect(registro.code_hash).toBe(hashDe(codigoEnviado()))
    expect(registro.code_hash).not.toContain(codigoEnviado())
    expect(JSON.stringify(registro)).not.toContain(codigoEnviado())
  })

  it('vincula o código à identidade e usa o usuário de sistema', async () => {
    await twofactor.issueCode(IDENTITY)

    expect(create.mock.calls[0][0]).toBe('two_factor_code')
    expect(registroGravado().identity_id).toBe(42)
    expect(create.mock.calls[0][3]).toBe(SYSTEM_USER)
  })

  it('define validade de dez minutos e devolve o vencimento', async () => {
    const antes = Date.now()
    const { expiresAt } = await twofactor.issueCode(IDENTITY)

    const margem = expiresAt.getTime() - antes
    expect(margem).toBeGreaterThan(9 * 60 * 1000)
    expect(margem).toBeLessThanOrEqual(10 * 60 * 1000 + 1000)
    expect(registroGravado().expires_at).toEqual(expiresAt)
  })

  it('gera código com zero à esquerda quando necessário', async () => {
    const vistos = new Set()
    for (let i = 0; i < 200; i++) {
      create.mockClear()
      enviar.mockClear()
      await twofactor.issueCode(IDENTITY)
      const codigo = codigoEnviado()
      expect(codigo).toMatch(/^\d{4}$/)
      vistos.add(codigo)
    }
    expect(vistos.size).toBeGreaterThan(1)
  })

  it('grava antes de enviar, para o código existir quando o e-mail chegar', async () => {
    await twofactor.issueCode(IDENTITY)

    expect(create.mock.invocationCallOrder[0]).toBeLessThan(enviar.mock.invocationCallOrder[0])
  })
})

describe('limite de reenvio', () => {
  const emitidoHa = (ms) => [{ id: 1, insert_date: new Date(Date.now() - ms) }]

  it('recusa reenvio antes do intervalo de trinta segundos', async () => {
    list.mockResolvedValue(emitidoHa(5000))

    await expect(
      twofactor.issueCode(IDENTITY, { respeitarIntervalo: true })
    ).rejects.toMatchObject({ status: 429, code: 'resend_too_soon' })
    expect(enviar).not.toHaveBeenCalled()
  })

  it('libera o reenvio depois do intervalo', async () => {
    list.mockResolvedValue(emitidoHa(twofactor.RESEND_INTERVAL_MS + 1000))

    await expect(twofactor.issueCode(IDENTITY, { respeitarIntervalo: true })).resolves.toBeTruthy()
    expect(enviar).toHaveBeenCalledOnce()
  })

  it('o login não é bloqueado pelo intervalo de reenvio', async () => {
    list.mockResolvedValue(emitidoHa(1000))

    await expect(twofactor.issueCode(IDENTITY)).resolves.toBeTruthy()
  })

  it('recusa quando o teto de códigos por hora foi atingido', async () => {
    list.mockResolvedValue(
      Array.from({ length: twofactor.MAX_CODIGOS_POR_JANELA }, (_, i) => ({
        id: i,
        insert_date: new Date(Date.now() - 60000)
      }))
    )

    await expect(twofactor.issueCode(IDENTITY)).rejects.toMatchObject({
      status: 429,
      code: 'too_many_codes'
    })
    expect(create).not.toHaveBeenCalled()
  })

  it('conta apenas os códigos da última hora, da identidade', async () => {
    await twofactor.issueCode(IDENTITY)

    const opcoes = list.mock.calls[0][1]
    expect(opcoes.where.identity_id).toBe(42)
    expect(opcoes.where.insert_date.op).toBe('>=')
    expect(Date.now() - opcoes.where.insert_date.value.getTime()).toBeGreaterThan(59 * 60 * 1000)
  })
})

describe('verifyCode', () => {
  it('consulta apenas o código mais recente ainda não consumido', async () => {
    await twofactor.verifyCode(IDENTITY, '1234')

    const [tabela, opcoes, , usuario] = list.mock.calls[0]
    expect(tabela).toBe('two_factor_code')
    expect(opcoes.where).toEqual({ identity_id: 42, consumed_at: null, active: true })
    expect(opcoes.orderBy).toEqual([{ column: 'insert_date', direction: 'DESC' }])
    expect(opcoes.limit).toBe(1)
    expect(usuario).toBe(SYSTEM_USER)
  })

  it('recusa quando não há código emitido', async () => {
    expect(await twofactor.verifyCode(IDENTITY, '1234')).toEqual({ ok: false, reason: 'no_code' })
    expect(update).not.toHaveBeenCalled()
  })

  it('recusa código expirado sem contar tentativa', async () => {
    list.mockResolvedValue([
      { id: 7, code_hash: hashDe('1234'), expires_at: daquiA(-1000), attempts: 0 }
    ])

    expect(await twofactor.verifyCode(IDENTITY, '1234')).toEqual({ ok: false, reason: 'expired' })
    expect(update).not.toHaveBeenCalled()
  })

  it('recusa após esgotar as tentativas', async () => {
    list.mockResolvedValue([
      {
        id: 7,
        code_hash: hashDe('1234'),
        expires_at: daquiA(60000),
        attempts: twofactor.MAX_ATTEMPTS
      }
    ])

    expect(await twofactor.verifyCode(IDENTITY, '9999')).toEqual({
      ok: false,
      reason: 'too_many_attempts'
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('conta a tentativa quando o código está errado', async () => {
    list.mockResolvedValue([
      { id: 7, code_hash: hashDe('1234'), expires_at: daquiA(60000), attempts: 2 }
    ])

    expect(await twofactor.verifyCode(IDENTITY, '9999')).toEqual({ ok: false, reason: 'invalid' })

    const [tabela, patch, opcoes, usuario] = update.mock.calls[0]
    expect(tabela).toBe('two_factor_code')
    expect(patch).toEqual({ attempts: 3 })
    expect(opcoes.where).toEqual({ id: 7 })
    expect(usuario).toBe(SYSTEM_USER)
  })

  it('aceita o código correto e marca como consumido', async () => {
    list.mockResolvedValue([
      { id: 7, code_hash: hashDe('1234'), expires_at: daquiA(60000), attempts: 0 }
    ])

    expect(await twofactor.verifyCode(IDENTITY, '1234')).toEqual({ ok: true })

    const [, patch, opcoes] = update.mock.calls[0]
    expect(patch.consumed_at).toBeInstanceOf(Date)
    expect(opcoes.where).toEqual({ id: 7 })
  })

  it('aceita código informado como número', async () => {
    list.mockResolvedValue([
      { id: 7, code_hash: hashDe('1234'), expires_at: daquiA(60000), attempts: 0 }
    ])

    expect(await twofactor.verifyCode(IDENTITY, 1234)).toEqual({ ok: true })
  })

  it('a expiração tem precedência sobre o código correto', async () => {
    list.mockResolvedValue([
      { id: 7, code_hash: hashDe('1234'), expires_at: daquiA(-1), attempts: 0 }
    ])

    expect(await twofactor.verifyCode(IDENTITY, '1234')).toEqual({ ok: false, reason: 'expired' })
  })

  it('não vaza o código correto na resposta de erro', async () => {
    list.mockResolvedValue([
      { id: 7, code_hash: hashDe('1234'), expires_at: daquiA(60000), attempts: 0 }
    ])

    const resposta = await twofactor.verifyCode(IDENTITY, '0000')

    expect(JSON.stringify(resposta)).not.toContain('1234')
  })
})

describe('issueCode e verifyCode juntos', () => {
  it('o código emitido valida na sequência', async () => {
    await twofactor.issueCode(IDENTITY)
    const codigo = codigoEnviado()
    const registro = registroGravado()

    list.mockResolvedValue([
      { id: 9, code_hash: registro.code_hash, expires_at: registro.expires_at, attempts: 0 }
    ])

    expect(await twofactor.verifyCode(IDENTITY, codigo)).toEqual({ ok: true })
  })

  it('um código emitido depois invalida o anterior', async () => {
    await twofactor.issueCode(IDENTITY)
    const primeiro = codigoEnviado()

    create.mockClear()
    enviar.mockClear()
    await twofactor.issueCode(IDENTITY)
    const segundo = registroGravado()

    list.mockResolvedValue([
      { id: 10, code_hash: segundo.code_hash, expires_at: segundo.expires_at, attempts: 0 }
    ])

    expect(await twofactor.verifyCode(IDENTITY, primeiro)).toEqual({ ok: false, reason: 'invalid' })
  })
})
