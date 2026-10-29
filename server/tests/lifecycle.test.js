import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const lifecycle = require('../services/lifecycle.js')
const contracts = require('../services/contracts.js')

const { MAQUINAS, estados, isState, allowedFrom, canTransition, assertTransition } = lifecycle

describe('as três máquinas declaradas', () => {
  it('cobrem os enums do banco', () => {
    expect(estados('enterprise').sort()).toEqual(['active', 'inactive', 'pending', 'suspended'])
    expect(estados('document').sort()).toEqual([
      'archived', 'draft', 'expired', 'pending', 'refused', 'signed'
    ])
    expect(estados('signature').sort()).toEqual([
      'expired', 'pending_submission', 'signed', 'waiting_signature'
    ])
  })

  it('todo destino declarado também é um estado conhecido', () => {
    for (const [nome, mapa] of Object.entries(MAQUINAS)) {
      for (const [de, destinos] of Object.entries(mapa)) {
        for (const para of destinos) {
          expect(isState(nome, para), `${nome}: ${de} -> ${para}`).toBe(true)
        }
      }
    }
  })

  it('nenhum estado se declara destino de si mesmo', () => {
    for (const [nome, mapa] of Object.entries(MAQUINAS)) {
      for (const [de, destinos] of Object.entries(mapa)) {
        expect(destinos, `${nome}.${de}`).not.toContain(de)
      }
    }
  })

  it('todo estado é alcançável a partir de algum outro, menos os iniciais', () => {
    const iniciais = { enterprise: 'pending', document: 'draft', signature: 'pending_submission' }
    for (const [nome, mapa] of Object.entries(MAQUINAS)) {
      const alcancaveis = new Set(Object.values(mapa).flat())
      for (const estado of Object.keys(mapa)) {
        if (estado === iniciais[nome]) continue
        expect(alcancaveis.has(estado), `${nome}.${estado} é inalcançável`).toBe(true)
      }
    }
  })
})

describe('ciclo de vida da empresa', () => {
  it.each([
    ['aprovar', 'pending', 'active'],
    ['recusar na triagem', 'pending', 'inactive'],
    ['pausar', 'active', 'suspended'],
    ['retomar', 'suspended', 'active'],
    ['encerrar', 'active', 'inactive'],
    ['recadastrar', 'inactive', 'pending']
  ])('permite %s', (_rotulo, de, para) => {
    expect(canTransition('enterprise', de, para)).toBe(true)
  })

  it.each([
    ['voltar à análise depois de aprovada', 'active', 'pending'],
    ['pular a análise', 'inactive', 'active'],
    ['suspender quem nunca foi aprovada', 'pending', 'suspended']
  ])('recusa %s', (_rotulo, de, para) => {
    expect(canTransition('enterprise', de, para)).toBe(false)
  })
})

describe('ciclo de vida do documento', () => {
  it.each([
    ['enviar para assinatura', 'draft', 'pending'],
    ['assinar', 'pending', 'signed'],
    ['recusar', 'pending', 'refused'],
    ['vencer sem assinar', 'pending', 'expired'],
    ['voltar ao rascunho antes de assinar', 'pending', 'draft'],
    ['corrigir um recusado', 'refused', 'draft'],
    ['vencer depois de assinado', 'signed', 'expired'],
    ['arquivar um assinado', 'signed', 'archived']
  ])('permite %s', (_rotulo, de, para) => {
    expect(canTransition('document', de, para)).toBe(true)
  })

  it('não deixa um contrato assinado voltar a ser rascunho', () => {
    expect(canTransition('document', 'signed', 'draft')).toBe(false)
    expect(canTransition('document', 'signed', 'pending')).toBe(false)
    expect(canTransition('document', 'signed', 'refused')).toBe(false)
  })

  it('arquivado é terminal', () => {
    expect(allowedFrom('document', 'archived')).toEqual([])
    for (const destino of estados('document')) {
      if (destino === 'archived') continue
      expect(canTransition('document', 'archived', destino)).toBe(false)
    }
  })

  it('não deixa pular do rascunho direto para assinado', () => {
    expect(canTransition('document', 'draft', 'signed')).toBe(false)
  })
})

describe('assertTransition', () => {
  it('aceita permanecer no mesmo estado, para a operação ser idempotente', () => {
    expect(() => assertTransition('enterprise', 'active', 'active')).not.toThrow()
    expect(() => assertTransition('document', 'archived', 'archived')).not.toThrow()
  })

  it('recusa destino que não é um estado, com código próprio', () => {
    try {
      assertTransition('enterprise', 'pending', 'aprovada')
      expect.unreachable()
    } catch (err) {
      expect(err.code).toBe('invalid_status')
      expect(err.status).toBe(409)
    }
  })

  it('recusa transição ilegal informando origem e destino', () => {
    try {
      assertTransition('document', 'signed', 'draft')
      expect.unreachable()
    } catch (err) {
      expect(err.code).toBe('invalid_transition')
      expect(err.status).toBe(409)
      expect(err.details).toEqual({ from: 'signed', to: 'draft' })
    }
  })

  it('recusa quando a origem é desconhecida', () => {
    expect(() => assertTransition('document', 'inventado', 'draft')).toThrow('invalid_transition')
  })

  it('não vaza a pilha nem texto cru na mensagem', () => {
    try {
      assertTransition('document', 'signed', 'draft')
    } catch (err) {
      expect(err.message).toBe('invalid_transition')
    }
  })
})

describe('a assinatura é uma projeção do documento', () => {
  it('toda transição legal de documento projeta uma transição legal de assinatura', () => {
    const conferidas = []

    for (const de of estados('document')) {
      for (const para of allowedFrom('document', de)) {
        const sigDe = contracts.signatureStatusFor(de)
        const sigPara = contracts.signatureStatusFor(para)
        if (sigDe === null || sigPara === null) continue

        expect(
          canTransition('signature', sigDe, sigPara),
          `documento ${de}→${para} projeta assinatura ${sigDe}→${sigPara}`
        ).toBe(true)
        conferidas.push(`${de}->${para}`)
      }
    }

    expect(conferidas.length).toBeGreaterThan(5)
  })

  it('arquivar não mexe na assinatura, porque não diz se foi assinado', () => {
    expect(contracts.signatureStatusFor('archived')).toBeNull()
  })

  it('cada status de documento projeta um status de assinatura conhecido', () => {
    for (const estado of estados('document')) {
      const projetado = contracts.signatureStatusFor(estado)
      if (projetado === null) continue
      expect(isState('signature', projetado), `documento ${estado}`).toBe(true)
    }
  })
})
