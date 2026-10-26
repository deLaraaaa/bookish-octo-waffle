import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const logger = require('../logger.js')

let saida
let erro

beforeEach(() => {
  saida = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
  erro = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ultimaLinha = (spy) => JSON.parse(spy.mock.calls.at(-1)[0])

describe('logger', () => {
  it.each([
    ['info', 'info'],
    ['warn', 'warn']
  ])('escreve %s na saída padrão', (metodo, nivel) => {
    logger[metodo]('algo_aconteceu')

    expect(erro).not.toHaveBeenCalled()
    expect(ultimaLinha(saida).level).toBe(nivel)
  })

  it('escreve erro na saída de erro, para o Promtail separar', () => {
    logger.error('algo_falhou')

    expect(saida).not.toHaveBeenCalled()
    expect(ultimaLinha(erro).level).toBe('error')
  })

  it('emite uma linha de JSON por chamada', () => {
    logger.info('evento')

    const bruto = saida.mock.calls.at(-1)[0]
    expect(bruto.endsWith('\n')).toBe(true)
    expect(bruto.trimEnd()).not.toContain('\n')
    expect(() => JSON.parse(bruto)).not.toThrow()
  })

  it('carimba data em ISO 8601', () => {
    logger.info('evento')

    const { ts } = ultimaLinha(saida)
    expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(Number.isNaN(Date.parse(ts))).toBe(false)
  })

  it('mescla os metadados no mesmo objeto', () => {
    logger.warn('contract_job_retry', { id: 7, attempts: 2 })

    expect(ultimaLinha(saida)).toMatchObject({
      level: 'warn',
      message: 'contract_job_retry',
      id: 7,
      attempts: 2
    })
  })

  it('funciona sem metadados', () => {
    logger.info('evento')
    expect(ultimaLinha(saida).message).toBe('evento')
  })

  it('metadado pode sobrescrever o campo padrão', () => {
    logger.info('evento', { level: 'debug' })
    expect(ultimaLinha(saida).level).toBe('debug')
  })
})
