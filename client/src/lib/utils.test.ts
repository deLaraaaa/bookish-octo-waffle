import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('junta classes em uma string', () => {
    expect(cn('a', 'b')).toBe('a b')
  })

  it('descarta valores falsos', () => {
    expect(cn('a', false, undefined, null, '', 'b')).toBe('a b')
  })

  it('aceita condicionais em objeto', () => {
    expect(cn('base', { ativo: true, inativo: false })).toBe('base ativo')
  })

  it('a última classe do Tailwind vence em caso de conflito', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('text-sm text-muted-foreground', 'text-lg')).toBe('text-muted-foreground text-lg')
  })

  it('sem argumentos devolve string vazia', () => {
    expect(cn()).toBe('')
  })
})
