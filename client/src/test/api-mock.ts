import { vi } from 'vitest'

export type RespostaFalsa = {
  ok?: boolean
  status?: number
  corpo?: unknown
  erro?: Error
}

export function jsonOk(corpo: unknown = {}) {
  return { ok: true, status: 200, json: async () => corpo }
}

export function jsonErro(status: number, corpo: unknown = {}) {
  return { ok: false, status, json: async () => corpo }
}

export function servidorFalso(rotas: Record<string, () => unknown>) {
  const buscar = vi.fn(async (url: string, init?: RequestInit) => {
    void init
    for (const [trecho, responder] of Object.entries(rotas)) {
      if (String(url).includes(trecho)) {
        const r = responder()
        if (r instanceof Error) throw r
        return r
      }
    }
    return jsonOk({})
  })
  vi.stubGlobal('fetch', buscar)
  return buscar
}
