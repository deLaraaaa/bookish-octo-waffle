import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const crud = require('../crud.js')
const tokens = require('../auth/jwt.js')
const microsoft = require('../auth/microsoft.js')
const twofactor = require('../auth/twofactor.js')
const graphToken = require('../services/graphToken.js')
const logger = require('../logger.js')
const auth = require('../services/auth.js')

const SYSTEM_USER = 'system:auth'
const FRONTEND = 'http://localhost:3000'

const PERFIL = {
  oid: 'oid-1',
  email: 'ra.cardoso@catolicasc.edu.br',
  name: 'Rafael de Lara'
}

const IDENTIDADE = {
  id: 10,
  uuid: 'i-1',
  person_id: 20,
  email: PERFIL.email,
  domain: 'catolicasc.edu.br',
  email_verified: true
}

const PESSOA = { id: 20, uuid: 'p-1', full_name: 'Rafael de Lara', role_id: null }

let leitura
let read
let create
let update
let configurado
let urlDeAutorizacao
let trocarCodigo
let buscarPerfil
let emitirCodigo
let verificarCodigo
let salvarRefresh

beforeEach(() => {
  leitura = { identity: null, person: PESSOA, role: null, role_invite: null, institution: null }

  read = vi.spyOn(crud, 'read').mockImplementation(async (tabela) => {
    const valor = leitura[tabela]
    return typeof valor === 'function' ? valor() : valor || null
  })
  create = vi.spyOn(crud, 'create').mockImplementation(async (tabela) => {
    if (tabela === 'person') return { ...PESSOA }
    return { ...IDENTIDADE, email_verified: false }
  })
  update = vi.spyOn(crud, 'update').mockResolvedValue([{ ...IDENTIDADE }])

  configurado = vi.spyOn(microsoft, 'isConfigured').mockReturnValue(true)
  urlDeAutorizacao = vi
    .spyOn(microsoft, 'authorizeUrl')
    .mockImplementation((state) => `https://login.microsoftonline.com/authorize?state=${state}`)
  trocarCodigo = vi
    .spyOn(microsoft, 'exchangeCode')
    .mockResolvedValue({ access_token: 'at', refresh_token: 'rt', scope: 'Files.ReadWrite' })
  buscarPerfil = vi.spyOn(microsoft, 'fetchProfile').mockResolvedValue({ ...PERFIL })

  emitirCodigo = vi.spyOn(twofactor, 'issueCode').mockResolvedValue({ expiresAt: new Date() })
  verificarCodigo = vi.spyOn(twofactor, 'verifyCode').mockResolvedValue({ ok: true })
  salvarRefresh = vi.spyOn(graphToken, 'saveRefreshToken').mockResolvedValue(undefined)

  vi.spyOn(logger, 'info').mockImplementation(() => {})
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})

const destino = (url) => {
  const u = new URL(url)
  return { path: u.pathname, params: Object.fromEntries(u.searchParams) }
}
const stateValido = () => tokens.signState({ n: 1 })
const desafioDe = (uuid = 'i-1') => tokens.signChallenge({ uuid, email: PERFIL.email })
const atualizacaoDe = (tabela) => update.mock.calls.find((c) => c[0] === tabela)

describe('microsoftAuthUrl', () => {
  it('recusa quando o Azure não está configurado', async () => {
    configurado.mockReturnValue(false)

    await expect(auth.microsoftAuthUrl()).rejects.toMatchObject({
      status: 503,
      code: 'azure_not_configured'
    })
  })

  it('assina um state verificável e o entrega à Microsoft', async () => {
    await auth.microsoftAuthUrl()

    const state = urlDeAutorizacao.mock.calls[0][0]
    expect(tokens.verify(state, 'oauth_state').typ).toBe('oauth_state')
  })
})

describe('handleMicrosoftCallback: rejeições antes do login', () => {
  it('devolve o erro que a Microsoft reportou', async () => {
    const { path, params } = destino(await auth.handleMicrosoftCallback({ error: 'access_denied' }))

    expect(path).toBe('/login')
    expect(params.error).toBe('access_denied')
  })

  it.each([
    ['sem código', { state: 'x' }],
    ['sem state', { code: 'x' }],
    ['sem nada', {}]
  ])('recusa retorno %s', async (_rotulo, query) => {
    expect(destino(await auth.handleMicrosoftCallback(query)).params.error).toBe('missing_params')
  })

  it('recusa state forjado', async () => {
    const resultado = await auth.handleMicrosoftCallback({ code: 'c', state: 'nao-e-jwt' })

    expect(destino(resultado).params.error).toBe('invalid_state')
    expect(trocarCodigo).not.toHaveBeenCalled()
  })

  it('recusa token de outro tipo usado como state', async () => {
    const sessao = tokens.signSession(PESSOA, 'ADMIN', PERFIL.email)

    expect(destino(await auth.handleMicrosoftCallback({ code: 'c', state: sessao })).params.error).toBe(
      'invalid_state'
    )
  })

  it.each([
    ['de fora da instituição', 'alguem@gmail.com'],
    ['ausente', null]
  ])('recusa e-mail %s', async (_rotulo, email) => {
    buscarPerfil.mockResolvedValue({ ...PERFIL, email })

    const resultado = await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })

    expect(destino(resultado).params.error).toBe('domain_not_allowed')
    expect(create).not.toHaveBeenCalled()
  })

  it.each([['catolicasc.edu.br'], ['catolicasc.org.br']])('aceita o domínio %s', async (dominio) => {
    buscarPerfil.mockResolvedValue({ ...PERFIL, email: `alguem@${dominio}` })
    leitura.identity = { ...IDENTIDADE }

    const resultado = await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })

    expect(destino(resultado).params.error).toBeUndefined()
  })

  it('erro inesperado vira falha genérica de login, sem vazar detalhe', async () => {
    trocarCodigo.mockRejectedValue(new Error('segredo do servidor'))

    const { path, params } = destino(
      await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })
    )

    expect(path).toBe('/login')
    expect(params.error).toBe('login_failed')
    expect(JSON.stringify(params)).not.toContain('segredo do servidor')
  })
})

describe('handleMicrosoftCallback: identidade', () => {
  it('cria pessoa e identidade no primeiro acesso', async () => {
    leitura.identity = null

    await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })

    expect(create.mock.calls[0][0]).toBe('person')
    expect(create.mock.calls[1][0]).toBe('identity')
    expect(create.mock.calls[1][1]).toMatchObject({
      provider: 'microsoft',
      microsoft_oid: 'oid-1',
      email_verified: false
    })
  })

  it('reaproveita a identidade existente e atualiza o último acesso', async () => {
    leitura.identity = { ...IDENTIDADE }

    await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })

    expect(create).not.toHaveBeenCalled()
    expect(atualizacaoDe('identity')[1]).toMatchObject({
      email: PERFIL.email,
      domain: 'catolicasc.edu.br'
    })
    expect(atualizacaoDe('identity')[1].last_login_at).toBeInstanceOf(Date)
  })

  it('guarda o refresh token do Graph quando a Microsoft devolve um', async () => {
    leitura.identity = { ...IDENTIDADE }

    await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })

    expect(salvarRefresh).toHaveBeenCalledWith(10, 'rt', 'Files.ReadWrite')
  })

  it('não tenta guardar quando não veio refresh token', async () => {
    trocarCodigo.mockResolvedValue({ access_token: 'at' })
    leitura.identity = { ...IDENTIDADE }

    await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })

    expect(salvarRefresh).not.toHaveBeenCalled()
  })

  it('falha ao guardar o refresh token não impede o login', async () => {
    salvarRefresh.mockRejectedValue(new Error('chave inválida'))
    leitura.identity = { ...IDENTIDADE }

    const { path } = destino(await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() }))

    expect(path).toBe('/auth/callback')
    expect(logger.warn).toHaveBeenCalledWith(
      'graph_token_save_failed',
      expect.objectContaining({ error: 'chave inválida' })
    )
  })
})

describe('handleMicrosoftCallback: segundo fator e sessão', () => {
  it('e-mail não verificado manda para o segundo fator', async () => {
    leitura.identity = null
    update.mockResolvedValue([{ ...IDENTIDADE, email_verified: false }])

    const { path, params } = destino(
      await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })
    )

    expect(path).toBe('/2fa')
    expect(emitirCodigo).toHaveBeenCalled()
    expect(tokens.verify(params.challenge, '2fa_challenge').sub).toBe('i-1')
  })

  it('e-mail verificado entra direto com token de sessão', async () => {
    leitura.identity = { ...IDENTIDADE }
    update.mockResolvedValue([{ ...IDENTIDADE }])

    const { path, params } = destino(
      await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })
    )

    expect(path).toBe('/auth/callback')
    expect(emitirCodigo).not.toHaveBeenCalled()
    const sessao = tokens.verify(params.token, 'session')
    expect(sessao.sub).toBe('p-1')
    expect(sessao.email).toBe(PERFIL.email)
  })
})

describe('resolução do papel no login', () => {
  const entrarComSessao = async () => {
    if (!leitura.identity) leitura.identity = { ...IDENTIDADE }
    update.mockResolvedValue([leitura.identity])
    const resultado = await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })
    return tokens.verify(destino(resultado).params.token, 'session').role
  }

  it('usa o papel já persistido na pessoa', async () => {
    leitura.person = { ...PESSOA, role_id: 2 }
    leitura.role = { name: 'MANAGER' }

    expect(await entrarComSessao()).toBe('MANAGER')
  })

  it('consome o convite pendente e persiste o papel', async () => {
    leitura.role_invite = { id: 5, role_id: 2 }
    leitura.role = { name: 'MANAGER' }

    expect(await entrarComSessao()).toBe('MANAGER')
    expect(atualizacaoDe('person')[1]).toEqual({ role_id: 2 })
    expect(atualizacaoDe('role_invite')[1].consumed_at).toBeInstanceOf(Date)
  })

  it('procura o convite pelo e-mail em minúsculas e ainda não consumido', async () => {
    leitura.identity = { ...IDENTIDADE, email: 'RA.Cardoso@Catolicasc.edu.br' }
    leitura.role_invite = { id: 5, role_id: 2 }
    leitura.role = { name: 'MANAGER' }
    update.mockResolvedValue([{ ...IDENTIDADE, email: 'RA.Cardoso@Catolicasc.edu.br' }])

    await auth.handleMicrosoftCallback({ code: 'c', state: stateValido() })

    const consulta = read.mock.calls.find((c) => c[0] === 'role_invite')[1]
    expect(consulta.where).toEqual({
      email: 'ra.cardoso@catolicasc.edu.br',
      active: true,
      consumed_at: null
    })
  })

  it.each([
    ['catolicasc.edu.br', 'STUDENT'],
    ['catolicasc.org.br', 'TEACHER']
  ])('sem papel nem convite, o domínio %s vira %s', async (dominio, esperado) => {
    leitura.identity = { ...IDENTIDADE, domain: dominio }
    update.mockResolvedValue([{ ...IDENTIDADE, domain: dominio }])

    expect(await entrarComSessao()).toBe(esperado)
  })

  it('papel persistido que não existe mais cai no padrão do domínio', async () => {
    leitura.person = { ...PESSOA, role_id: 99 }
    leitura.role = null

    expect(await entrarComSessao()).toBe('STUDENT')
  })
})

describe('verifyTwoFactor', () => {
  beforeEach(() => {
    leitura.identity = { ...IDENTIDADE, email_verified: false }
  })

  it.each([
    ['sem desafio', { code: '1234' }],
    ['sem código', { challenge: 'x' }],
    ['sem nada', {}]
  ])('recusa requisição %s', async (_rotulo, entrada) => {
    await expect(auth.verifyTwoFactor(entrada)).rejects.toMatchObject({
      status: 400,
      code: 'missing_params'
    })
  })

  it('recusa desafio forjado', async () => {
    await expect(
      auth.verifyTwoFactor({ challenge: 'nao-e-jwt', code: '1234' })
    ).rejects.toMatchObject({ status: 401, code: 'invalid_challenge' })
  })

  it('recusa token de sessão usado como desafio', async () => {
    const sessao = tokens.signSession(PESSOA, 'ADMIN', PERFIL.email)

    await expect(auth.verifyTwoFactor({ challenge: sessao, code: '1234' })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_challenge'
    })
  })

  it('recusa identidade inexistente', async () => {
    leitura.identity = null

    await expect(
      auth.verifyTwoFactor({ challenge: desafioDe(), code: '1234' })
    ).rejects.toMatchObject({ status: 404, code: 'identity_not_found' })
  })

  it.each([
    ['expirado', 'expired'],
    ['errado', 'invalid'],
    ['sem código emitido', 'no_code'],
    ['tentativas esgotadas', 'too_many_attempts']
  ])('propaga o motivo quando o código está %s', async (_rotulo, reason) => {
    verificarCodigo.mockResolvedValue({ ok: false, reason })

    await expect(
      auth.verifyTwoFactor({ challenge: desafioDe(), code: '0000' })
    ).rejects.toMatchObject({ status: 401, code: reason })
    expect(update).not.toHaveBeenCalled()
  })

  it('marca o e-mail como verificado e devolve a sessão', async () => {
    const { token } = await auth.verifyTwoFactor({ challenge: desafioDe(), code: '1234' })

    expect(atualizacaoDe('identity')[1]).toEqual({ email_verified: true, active: true })
    expect(tokens.verify(token, 'session').sub).toBe('p-1')
  })
})

describe('resendTwoFactor', () => {
  it('recusa requisição sem desafio', async () => {
    await expect(auth.resendTwoFactor({})).rejects.toMatchObject({
      status: 400,
      code: 'missing_params'
    })
  })

  it('recusa desafio inválido', async () => {
    await expect(auth.resendTwoFactor({ challenge: 'x' })).rejects.toMatchObject({
      status: 401,
      code: 'invalid_challenge'
    })
  })

  it('recusa identidade inexistente', async () => {
    leitura.identity = null

    await expect(auth.resendTwoFactor({ challenge: desafioDe() })).rejects.toMatchObject({
      status: 404,
      code: 'identity_not_found'
    })
  })

  it('emite um novo código para a identidade do desafio', async () => {
    leitura.identity = { ...IDENTIDADE }

    expect(await auth.resendTwoFactor({ challenge: desafioDe() })).toEqual({ ok: true })
    expect(emitirCodigo).toHaveBeenCalledWith(leitura.identity, { respeitarIntervalo: true })
  })
})

describe('getAccount', () => {
  const CLAIMS = { sub: 'p-1', email: PERFIL.email, role: 'MANAGER' }

  beforeEach(() => {
    leitura.person = {
      uuid: 'p-1',
      full_name: 'Rafael de Lara',
      institution_id: null,
      onboarding_completed: true
    }
  })

  it('recusa pessoa inexistente', async () => {
    leitura.person = null

    await expect(auth.getAccount(CLAIMS)).rejects.toMatchObject({
      status: 404,
      code: 'person_not_found'
    })
  })

  it('monta a conta a partir dos dados da pessoa e do token', async () => {
    leitura.role = { id: 2 }

    const { account } = await auth.getAccount(CLAIMS)

    expect(account).toMatchObject({
      uuid: 'p-1',
      name: 'Rafael de Lara',
      email: PERFIL.email,
      status: 'active',
      role: 'MANAGER',
      role_id: 2,
      onboarding_completed: true
    })
  })

  it('sem instituição, não consulta nem preenche os campos dela', async () => {
    const { account } = await auth.getAccount(CLAIMS)

    expect(account.institution_name).toBeNull()
    expect(account.institution_city).toBeNull()
    expect(read.mock.calls.some((c) => c[0] === 'institution')).toBe(false)
  })

  it('com instituição, preenche nome e cidade', async () => {
    leitura.person = { ...leitura.person, institution_id: 7 }
    leitura.institution = { name: 'Campus Jaraguá', city: 'Jaraguá do Sul' }

    const { account } = await auth.getAccount(CLAIMS)

    expect(account.institution_name).toBe('Campus Jaraguá')
    expect(account.institution_city).toBe('Jaraguá do Sul')
  })

  it('instituição apagada não quebra a conta', async () => {
    leitura.person = { ...leitura.person, institution_id: 7 }
    leitura.institution = null

    expect((await auth.getAccount(CLAIMS)).account.institution_name).toBeNull()
  })

  it('token sem papel devolve papel e identificador nulos', async () => {
    const { account } = await auth.getAccount({ sub: 'p-1' })

    expect(account.role).toBeNull()
    expect(account.role_id).toBeNull()
    expect(account.email).toBeNull()
  })

  it('papel do token que não existe no banco devolve identificador nulo', async () => {
    leitura.role = null

    expect((await auth.getAccount(CLAIMS)).account.role_id).toBeNull()
  })
})

describe('submitOnboarding', () => {
  const CLAIMS = { sub: 'p-1' }

  beforeEach(() => {
    leitura.institution = { id: 7, name: 'Campus Jaraguá' }
    update.mockResolvedValue([{ uuid: 'p-1' }])
  })

  it.each([
    ['ausente', {}],
    ['zero', { institution_id: 0 }],
    ['texto', { institution_id: 'abc' }],
    ['corpo nulo', null]
  ])('recusa instituição %s', async (_rotulo, body) => {
    await expect(auth.submitOnboarding(CLAIMS, body)).rejects.toMatchObject({
      status: 400,
      code: 'institution_required'
    })
  })

  it('recusa instituição inexistente', async () => {
    leitura.institution = null

    await expect(auth.submitOnboarding(CLAIMS, { institution_id: 99 })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_institution'
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('recusa quando a atualização não encontra a pessoa', async () => {
    update.mockResolvedValue([])

    await expect(auth.submitOnboarding(CLAIMS, { institution_id: 7 })).rejects.toMatchObject({
      status: 404,
      code: 'person_not_found'
    })
  })

  it('vincula a instituição e encerra o onboarding', async () => {
    expect(await auth.submitOnboarding(CLAIMS, { institution_id: 7 })).toEqual({ ok: true })

    expect(atualizacaoDe('person')[1]).toEqual({
      institution_id: 7,
      onboarding_completed: true
    })
    expect(atualizacaoDe('person')[2].where).toEqual({ uuid: 'p-1' })
  })

  it('aceita o identificador vindo como texto numérico', async () => {
    await auth.submitOnboarding(CLAIMS, { institution_id: '7' })

    expect(atualizacaoDe('person')[1].institution_id).toBe(7)
  })

  it('consulta o banco como usuário de sistema', async () => {
    await auth.submitOnboarding(CLAIMS, { institution_id: 7 })

    expect(atualizacaoDe('person')[3]).toBe(SYSTEM_USER)
  })
})
