import { describe, expect, it } from 'vitest'
import { daysSince, waitTone, waitToneClasses, WAIT_LATE_DAYS, WAIT_WARN_DAYS } from './time'

const AGORA = new Date('2026-10-29T12:00:00Z').getTime()
const diasAtras = (n: number) => new Date(AGORA - n * 86400000).toISOString()

describe('daysSince', () => {
  it('conta os dias inteiros desde a data', () => {
    expect(daysSince(diasAtras(12), AGORA)).toBe(12)
  })

  it('devolve zero no mesmo dia', () => {
    expect(daysSince(new Date(AGORA - 3600000).toISOString(), AGORA)).toBe(0)
  })

  it('nunca devolve negativo para data no futuro', () => {
    expect(daysSince(diasAtras(-5), AGORA)).toBe(0)
  })

  it('devolve null sem data', () => {
    expect(daysSince(null, AGORA)).toBeNull()
    expect(daysSince(undefined, AGORA)).toBeNull()
    expect(daysSince('', AGORA)).toBeNull()
  })

  it('devolve null para data ilegível', () => {
    expect(daysSince('ontem', AGORA)).toBeNull()
  })
})

describe('waitTone', () => {
  it('trata espera curta como normal', () => {
    expect(waitTone(0)).toBe('fresh')
    expect(waitTone(WAIT_WARN_DAYS - 1)).toBe('fresh')
  })

  it('alerta a partir do limite de atenção', () => {
    expect(waitTone(WAIT_WARN_DAYS)).toBe('warn')
    expect(waitTone(WAIT_LATE_DAYS - 1)).toBe('warn')
  })

  it('escala quando passa do prazo', () => {
    expect(waitTone(WAIT_LATE_DAYS)).toBe('late')
    expect(waitTone(60)).toBe('late')
  })

  it('sem data conhecida não alarma', () => {
    expect(waitTone(null)).toBe('fresh')
  })
})

describe('waitToneClasses', () => {
  it('usa a cor de erro só no atraso', () => {
    expect(waitToneClasses('late')).toContain('destructive')
    expect(waitToneClasses('warn')).not.toContain('destructive')
    expect(waitToneClasses('fresh')).not.toContain('destructive')
  })

  it('distingue os três tons', () => {
    const tons = [waitToneClasses('fresh'), waitToneClasses('warn'), waitToneClasses('late')]
    expect(new Set(tons).size).toBe(3)
  })
})
