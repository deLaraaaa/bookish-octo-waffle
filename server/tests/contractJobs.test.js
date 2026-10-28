import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const db = require('../db.js')
const crud = require('../crud.js')
const logger = require('../logger.js')
const storage = require('../services/storage.js')
const contracts = require('../services/contracts.js')
const graphToken = require('../services/graphToken.js')
const contractJobs = require('../services/contractJobs.js')

const ATOR = 'p-1'
const EMAIL = 'ra.cardoso@catolicasc.edu.br'
const SYSTEM_USER = 'system:contract-job'

const JOB = {
  id: 1,
  template_uuid: 't-1',
  values: { nome: 'ACME' },
  out_name: 'Contrato ACME',
  as_pdf: true,
  enterprise_uuid: null,
  requested_by: ATOR,
  requested_by_email: EMAIL,
  attempts: 1
}

const SAIDA_PADRAO = {
  docx: { id: 'i-docx', name: 'Contrato ACME.docx' },
  pdf: { id: 'i-pdf', name: 'Contrato ACME.pdf' }
}

let consulta
let read
let create
let update
let exportar
let vincular
let token

beforeEach(() => {
  consulta = vi.spyOn(db, 'query').mockResolvedValue({ rows: [] })
  read = vi.spyOn(crud, 'read').mockResolvedValue({ file_path: 'onedrive:tpl-1' })
  create = vi.spyOn(crud, 'create').mockResolvedValue({ uuid: 'j-1', status: 'queued' })
  update = vi.spyOn(crud, 'update').mockResolvedValue([])
  exportar = vi.spyOn(storage, 'exportContract').mockResolvedValue({ ...SAIDA_PADRAO })
  vincular = vi.spyOn(contracts, 'linkToEnterprise').mockResolvedValue({ document_uuid: 'd-1' })
  token = vi.spyOn(graphToken, 'accessTokenForEmail').mockResolvedValue('tok')
  vi.spyOn(logger, 'warn').mockImplementation(() => {})
  vi.spyOn(logger, 'info').mockImplementation(() => {})
  vi.spyOn(logger, 'error').mockImplementation(() => {})
})

afterEach(() => {
  contractJobs.stop()
  vi.useRealTimers()
})

function filaDoBanco(...jobs) {
  const pendentes = [...jobs]
  consulta.mockImplementation(async () => ({
    rows: pendentes.length ? [pendentes.shift()] : []
  }))
}

const pedidoEnfileirado = () => create.mock.calls[0][1]
const marcacoes = () => update.mock.calls.filter((c) => c[0] === 'contract_job').map((c) => c[1])
const aguardarMarcacao = () => vi.waitFor(() => expect(marcacoes().length).toBeGreaterThan(0))

describe('enqueue', () => {
  it('devolve o identificador do pedido na hora', async () => {
    expect(await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })).toEqual({
      uuid: 'j-1',
      status: 'queued'
    })
  })

  it('serializa os valores do template em JSON', async () => {
    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1', values: { nome: 'ACME' } })

    expect(pedidoEnfileirado().values).toBe('{"nome":"ACME"}')
  })

  it('sem valores, grava um objeto vazio', async () => {
    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })

    expect(pedidoEnfileirado().values).toBe('{}')
  })

  it('guarda quem pediu e o e-mail, para o worker reobter o token depois', async () => {
    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })

    expect(pedidoEnfileirado().requested_by).toBe(ATOR)
    expect(pedidoEnfileirado().requested_by_email).toBe(EMAIL)
  })

  it.each([
    ['verdadeiro', true, true],
    ['ausente', undefined, false],
    ['string', 'sim', true]
  ])('normaliza asPdf %s para booleano', async (_rotulo, entrada, esperado) => {
    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1', asPdf: entrada })

    expect(pedidoEnfileirado().as_pdf).toBe(esperado)
  })

  it('empresa ausente vira nulo', async () => {
    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })

    expect(pedidoEnfileirado().enterprise_uuid).toBeNull()
  })

  it('acorda o worker sem esperar o próximo tique', async () => {
    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })

    await vi.waitFor(() => expect(consulta).toHaveBeenCalled())
  })
})

describe('getByUuid', () => {
  it('recusa pedido inexistente', async () => {
    read.mockResolvedValue(null)

    await expect(contractJobs.getByUuid(ATOR, 'j-9')).rejects.toMatchObject({
      status: 404,
      code: 'job_not_found'
    })
  })

  it('devolve o estado do pedido', async () => {
    read.mockResolvedValue({ uuid: 'j-1', status: 'done', result: '{}' })

    expect(await contractJobs.getByUuid(ATOR, 'j-1')).toMatchObject({ status: 'done' })
  })
})

describe('worker: pedido concluído', () => {
  it('gera o contrato e marca o pedido como concluído', async () => {
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    const [marcacao] = marcacoes()
    expect(marcacao.status).toBe('done')
    expect(marcacao.error).toBeNull()
    expect(marcacao.finished_at).toBeInstanceOf(Date)
    expect(JSON.parse(marcacao.result)).toMatchObject(SAIDA_PADRAO)
  })

  it('reobtém o token do Graph pelo e-mail de quem pediu', async () => {
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(token).toHaveBeenCalledWith(EMAIL)
    expect(exportar.mock.calls[0][0]).toBe('tok')
  })

  it('exporta a partir do caminho do template, repassando os valores', async () => {
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    const [, caminho, valores, nome, opcoes] = exportar.mock.calls[0]
    expect(caminho).toBe('onedrive:tpl-1')
    expect(valores).toEqual({ nome: 'ACME' })
    expect(nome).toBe('Contrato ACME')
    expect(opcoes).toEqual({ asPdf: true })
  })

  it('usa o usuário de sistema para marcar o pedido', async () => {
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    const chamada = update.mock.calls.find((c) => c[0] === 'contract_job')
    expect(chamada[3]).toBe(SYSTEM_USER)
  })
})

describe('worker: vínculo com a empresa', () => {
  it('vincula o PDF quando ele existe', async () => {
    filaDoBanco({ ...JOB, enterprise_uuid: 'e-1' })

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(vincular).toHaveBeenCalledWith(ATOR, {
      enterpriseUuid: 'e-1',
      itemId: 'i-pdf',
      name: 'Contrato ACME.pdf'
    })
  })

  it('sem PDF, vincula o docx', async () => {
    exportar.mockResolvedValue({ docx: SAIDA_PADRAO.docx })
    filaDoBanco({ ...JOB, enterprise_uuid: 'e-1' })

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(vincular.mock.calls[0][1].itemId).toBe('i-docx')
  })

  it('registra o vínculo no resultado do pedido', async () => {
    filaDoBanco({ ...JOB, enterprise_uuid: 'e-1' })

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(JSON.parse(marcacoes()[0].result).linked).toEqual({
      enterpriseUuid: 'e-1',
      document_uuid: 'd-1'
    })
  })

  it('contrato regerado que já estava vinculado conclui com sucesso', async () => {
    vincular.mockRejectedValue(
      Object.assign(new Error('contract_already_linked'), { status: 409, code: 'contract_already_linked' })
    )
    filaDoBanco({ ...JOB, enterprise_uuid: 'e-1' })

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].status).toBe('done')
    expect(JSON.parse(marcacoes()[0].result).linked).toEqual({
      enterpriseUuid: 'e-1',
      already_linked: true
    })
  })

  it('outra falha ao vincular continua derrubando o pedido', async () => {
    vincular.mockRejectedValue(
      Object.assign(new Error('enterprise_not_found'), { status: 404, code: 'enterprise_not_found' })
    )
    filaDoBanco({ ...JOB, enterprise_uuid: 'e-1' })

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].status).toBe('failed')
  })

  it('sem empresa, não vincula nada', async () => {
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(vincular).not.toHaveBeenCalled()
  })
})

describe('worker: tratamento de falha', () => {
  const falharCom = (erro) => exportar.mockRejectedValue(erro)
  const erroCom = (status) => Object.assign(new Error('falhou'), { status, code: 'erro_x' })

  it('template inexistente falha de vez, sem nova tentativa', async () => {
    read.mockResolvedValue(null)
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].status).toBe('failed')
    expect(marcacoes()[0].error).toContain('template_not_found')
  })

  it.each([
    ['400', 400],
    ['404', 404],
    ['409', 409]
  ])('erro %s é permanente e não volta para a fila', async (_rotulo, status) => {
    falharCom(erroCom(status))
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].status).toBe('failed')
  })

  it.each([
    ['408', 408],
    ['429', 429],
    ['500', 500],
    ['503', 503]
  ])('erro %s é transitório e volta para a fila', async (_rotulo, status) => {
    falharCom(erroCom(status))
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].status).toBe('queued')
    expect(marcacoes()[0].started_at).toBeNull()
  })

  it('erro sem status é tratado como transitório', async () => {
    falharCom(new Error('conexão caiu'))
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].status).toBe('queued')
  })

  it('desiste depois de esgotar as tentativas, mesmo em erro transitório', async () => {
    falharCom(erroCom(500))
    filaDoBanco({ ...JOB, attempts: 3 })

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].status).toBe('failed')
  })

  it('guarda o último erro ao devolver o pedido para a fila', async () => {
    falharCom(erroCom(500))
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].error).toBe('erro_x')
  })

  it('anexa os detalhes do erro à mensagem gravada', async () => {
    falharCom(Object.assign(new Error('x'), { status: 400, code: 'missing_variables', details: { missing: ['cnpj'] } }))
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].error).toBe('missing_variables: {"missing":["cnpj"]}')
  })

  it('detalhe de erro que não serializa não quebra a gravação', async () => {
    const circular = { campo: 'x' }
    circular.ele_mesmo = circular
    falharCom(Object.assign(new Error('x'), { status: 400, code: 'erro_circular', details: circular }))
    filaDoBanco(JOB)

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await aguardarMarcacao()

    expect(marcacoes()[0].error).toBe('erro_circular')
  })

  it('falha no banco durante o tique não derruba o worker', async () => {
    consulta.mockRejectedValue(new Error('conexão perdida'))

    await expect(contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })).resolves.toBeTruthy()
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith(
        'contract_job_tick_failed',
        expect.objectContaining({ error: 'conexão perdida' })
      )
    )
  })

  it('processa a fila inteira em um tique só', async () => {
    filaDoBanco(JOB, { ...JOB, id: 2 }, { ...JOB, id: 3 })

    await contractJobs.enqueue(ATOR, EMAIL, { templateUuid: 't-1' })
    await vi.waitFor(() => expect(marcacoes()).toHaveLength(3))

    expect(marcacoes().every((m) => m.status === 'done')).toBe(true)
  })
})

describe('start e stop', () => {
  it('devolve à fila os pedidos presos em processamento', async () => {
    vi.useFakeTimers()
    update.mockResolvedValue([{ id: 1 }, { id: 2 }])

    contractJobs.start()

    await vi.waitFor(() => expect(update).toHaveBeenCalled())
    const [tabela, patch, opcoes] = update.mock.calls[0]
    expect(tabela).toBe('contract_job')
    expect(patch).toEqual({ status: 'queued', started_at: null })
    expect(opcoes.where).toEqual({ status: 'processing' })
  })

  it('avisa quando recuperou pedidos órfãos', async () => {
    vi.useFakeTimers()
    update.mockResolvedValue([{ id: 1 }])

    contractJobs.start()

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith('contract_job_recovered', { count: 1 })
    )
  })

  it('chamar start duas vezes não cria um segundo worker', async () => {
    vi.useFakeTimers()

    contractJobs.start()
    contractJobs.start()

    expect(logger.info).toHaveBeenCalledOnce()
  })

  it('falha ao recuperar não impede o worker de subir', async () => {
    vi.useFakeTimers()
    update.mockRejectedValue(new Error('banco fora'))

    contractJobs.start()

    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith(
        'contract_job_recover_failed',
        expect.objectContaining({ error: 'banco fora' })
      )
    )
  })

  it('stop encerra o worker e permite subir de novo', async () => {
    vi.useFakeTimers()

    contractJobs.start()
    contractJobs.stop()
    contractJobs.start()

    expect(logger.info).toHaveBeenCalledTimes(2)
  })

  it('stop é seguro mesmo sem worker rodando', () => {
    expect(() => contractJobs.stop()).not.toThrow()
  })
})
