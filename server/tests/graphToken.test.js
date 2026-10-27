import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const microsoft = require('../auth/microsoft.js')
const tokenCrypto = require('../auth/tokenCrypto.js')
const logger = require('../logger.js')
const graphToken = require('../services/graphToken.js')

const SYSTEM_USER = 'system:graph'
const EMAIL = 'ra.cardoso@catolicasc.edu.br'
const IDENTIDADE = { id: 10, uuid: 'i-1', email: EMAIL }

let leitura
let read
let create
let update
let renovar

beforeEach(() => {
  leitura = { identity: null, ms_oauth_token: null }

  read = vi.spyOn(crud, 'read').mockImplementation(async (tabela) => leitura[tabela] || null)
  create = vi.spyOn(crud, 'create').mockResolvedValue({ id: 1 })
  update = vi.spyOn(crud, 'update').mockResolvedValue([{ id: 1 }])
  renovar = vi
    .spyOn(microsoft, 'refreshToken')
    .mockResolvedValue({ access_token: 'at-novo', refresh_token: 'rt-1', scope: 'Files.ReadWrite' })
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
})

describe('saveRefreshToken', () => {
  it('ignora chamada sem token', async () => {
    await graphToken.saveRefreshToken(10, null, 'escopo')
    await graphToken.saveRefreshToken(10, '', 'escopo')

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('cifra o token antes de gravar', async () => {
    await graphToken.saveRefreshToken(10, 'rt-secreto', 'Files.ReadWrite')

    const gravado = create.mock.calls[0][1].refresh_token
    expect(gravado).not.toContain('rt-secreto')
    expect(tokenCrypto.decrypt(gravado)).toBe('rt-secreto')
  })

  it('cria o registro quando a identidade ainda não tem token', async () => {
    await graphToken.saveRefreshToken(10, 'rt-1', 'Files.ReadWrite')

    expect(create.mock.calls[0][0]).toBe('ms_oauth_token')
    expect(create.mock.calls[0][1]).toMatchObject({ identity_id: 10, scope: 'Files.ReadWrite' })
    expect(create.mock.calls[0][3]).toBe(SYSTEM_USER)
  })

  it('atualiza o registro existente em vez de duplicar', async () => {
    leitura.ms_oauth_token = { id: 55 }

    await graphToken.saveRefreshToken(10, 'rt-2', 'Files.ReadWrite')

    expect(create).not.toHaveBeenCalled()
    expect(update.mock.calls[0][2].where).toEqual({ id: 55 })
    expect(update.mock.calls[0][1].updated_at).toBeInstanceOf(Date)
  })

  it('escopo ausente é gravado como nulo', async () => {
    await graphToken.saveRefreshToken(10, 'rt-1')
    expect(create.mock.calls[0][1].scope).toBeNull()

    leitura.ms_oauth_token = { id: 55 }
    await graphToken.saveRefreshToken(10, 'rt-1')
    expect(update.mock.calls[0][1].scope).toBeNull()
  })
})

describe('accessTokenForEmail', () => {
  const comTokenGuardado = (valor = 'rt-1') => {
    leitura.identity = { ...IDENTIDADE }
    leitura.ms_oauth_token = { id: 55, refresh_token: tokenCrypto.encrypt(valor) }
  }

  it('recusa e-mail sem identidade', async () => {
    await expect(graphToken.accessTokenForEmail(EMAIL)).rejects.toMatchObject({
      status: 404,
      code: 'identity_not_found'
    })
  })

  it('procura a identidade com o e-mail em minúsculas', async () => {
    leitura.identity = { ...IDENTIDADE }

    await graphToken.accessTokenForEmail('RA.Cardoso@Catolicasc.EDU.br').catch(() => {})

    expect(read.mock.calls[0][1].where).toEqual({ email: 'ra.cardoso@catolicasc.edu.br' })
  })

  it('avisa quando o OneDrive nunca foi conectado', async () => {
    leitura.identity = { ...IDENTIDADE }

    await expect(graphToken.accessTokenForEmail(EMAIL)).rejects.toMatchObject({
      status: 412,
      code: 'onedrive_not_connected'
    })
  })

  it('token guardado que não decifra vira erro de servidor', async () => {
    leitura.identity = { ...IDENTIDADE }
    leitura.ms_oauth_token = { id: 55, refresh_token: 'lixo-que-nao-decifra' }

    await expect(graphToken.accessTokenForEmail(EMAIL)).rejects.toMatchObject({
      status: 500,
      code: 'token_decrypt_failed'
    })
    expect(renovar).not.toHaveBeenCalled()
  })

  it('refresh recusado pela Microsoft pede nova autorização', async () => {
    comTokenGuardado()
    renovar.mockRejectedValue(new Error('invalid_grant'))

    await expect(graphToken.accessTokenForEmail(EMAIL)).rejects.toMatchObject({
      status: 401,
      code: 'onedrive_reauth_required'
    })
    expect(logger.warn).toHaveBeenCalledWith(
      'graph_refresh_failed',
      expect.objectContaining({ identity: 'i-1', error: 'invalid_grant' })
    )
  })

  it('devolve o access token renovado', async () => {
    comTokenGuardado()

    expect(await graphToken.accessTokenForEmail(EMAIL)).toBe('at-novo')
    expect(renovar).toHaveBeenCalledWith('rt-1')
  })

  it('guarda o novo refresh token quando a Microsoft o rotaciona', async () => {
    comTokenGuardado('rt-antigo')
    renovar.mockResolvedValue({ access_token: 'at', refresh_token: 'rt-rotacionado', scope: 'novo' })

    await graphToken.accessTokenForEmail(EMAIL)

    expect(update.mock.calls[0][0]).toBe('ms_oauth_token')
    expect(tokenCrypto.decrypt(update.mock.calls[0][1].refresh_token)).toBe('rt-rotacionado')
  })

  it('não regrava quando o refresh token continua o mesmo', async () => {
    comTokenGuardado('rt-1')
    renovar.mockResolvedValue({ access_token: 'at', refresh_token: 'rt-1' })

    await graphToken.accessTokenForEmail(EMAIL)

    expect(update).not.toHaveBeenCalled()
  })

  it('não regrava quando a Microsoft não devolve refresh token', async () => {
    comTokenGuardado()
    renovar.mockResolvedValue({ access_token: 'at' })

    await graphToken.accessTokenForEmail(EMAIL)

    expect(update).not.toHaveBeenCalled()
  })
})
