import { describe, expect, it } from 'vitest'
import { humanizeVariable, normalizeVariable, valueFromEnterprise } from './variables'
import type { EnterpriseOption } from '@/lib/api'

const EMPRESA: EnterpriseOption = {
  uuid: 'e-1',
  name: 'Kohlbach Motores S.A.',
  cnpj: '11222333000181',
  street: 'Rua Joinville',
  number: '3800',
  neighborhood: 'Vila Lalau',
  city: 'Jaraguá do Sul',
  state: 'SC',
  zip_code: '89256900',
  phone_number: '4733728000',
  responsible_person: 'Marina Souza',
  contact_email: 'marina@kohlbach.com.br',
} as EnterpriseOption

describe('normalizeVariable', () => {
  it('ignora acento, caixa e pontuação', () => {
    expect(normalizeVariable('Razão_Social')).toBe('razaosocial')
    expect(normalizeVariable('CNPJ')).toBe('cnpj')
    expect(normalizeVariable('endereço-completo')).toBe('enderecocompleto')
  })

  it('devolve string vazia para entrada vazia', () => {
    expect(normalizeVariable('')).toBe('')
  })
})

describe('humanizeVariable', () => {
  it('transforma snake_case em frase legível', () => {
    expect(humanizeVariable('razao_social')).toBe('Razao social')
    expect(humanizeVariable('data_assinatura')).toBe('Data assinatura')
  })

  it('separa camelCase', () => {
    expect(humanizeVariable('dataAssinatura')).toBe('Data assinatura')
  })

  it('mostra caminho aninhado com separador', () => {
    expect(humanizeVariable('socios.nome')).toBe('Socios \u203a Nome')
  })

  it('não devolve a sintaxe crua do modelo', () => {
    expect(humanizeVariable('cnpj')).not.toContain('{')
    expect(humanizeVariable('cnpj')).not.toContain('_')
  })

  it('aguenta nome vazio', () => {
    expect(humanizeVariable('')).toBe('')
  })
})

describe('valueFromEnterprise', () => {
  it('casa a variável pelo nome normalizado', () => {
    expect(valueFromEnterprise('RAZAO_SOCIAL', EMPRESA)).toBe('Kohlbach Motores S.A.')
    expect(valueFromEnterprise('cnpj', EMPRESA)).toBe('11222333000181')
    expect(valueFromEnterprise('Município', EMPRESA)).toBe('Jaraguá do Sul')
  })

  it('monta o endereço completo a partir das partes', () => {
    expect(valueFromEnterprise('endereco', EMPRESA)).toBe(
      'Rua Joinville, 3800 - Vila Lalau - Jaraguá do Sul/SC'
    )
  })

  it('devolve null para variável que o cadastro não conhece', () => {
    expect(valueFromEnterprise('clausula_penal', EMPRESA)).toBeNull()
  })

  it('não inventa endereço quando não há dado', () => {
    const vazia = { ...EMPRESA, street: null, number: null, neighborhood: null, city: null, state: null }
    expect(valueFromEnterprise('endereco', vazia as EnterpriseOption)).toBeNull()
  })
})
