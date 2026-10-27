import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'

const API = 'http://localhost:4000'
const TOKEN_KEY = 'tcc.token'

let buscar: ReturnType<typeof vi.fn>

function respostaOk(corpo: unknown = {}) {
  return { ok: true, status: 200, json: async () => corpo }
}

function respostaErro(status: number, corpo: unknown = null) {
  return {
    ok: false,
    status,
    json: async () => {
      if (corpo === null) throw new Error('sem corpo')
      return corpo
    },
  }
}

const chamada = () => buscar.mock.calls.at(-1) as [string, RequestInit]
const urlChamada = () => chamada()[0]
const opcoesChamada = () => chamada()[1]

beforeEach(() => {
  buscar = vi.fn().mockResolvedValue(respostaOk())
  vi.stubGlobal('fetch', buscar)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('token na sessão do navegador', () => {
  it('guarda, lê e apaga o token', () => {
    expect(api.getToken()).toBeNull()

    api.setToken('abc.def.ghi')
    expect(api.getToken()).toBe('abc.def.ghi')
    expect(localStorage.getItem(TOKEN_KEY)).toBe('abc.def.ghi')

    api.clearToken()
    expect(api.getToken()).toBeNull()
  })
})

describe('api', () => {
  it('monta a URL a partir do endereço da API', async () => {
    await api.api('/health')

    expect(urlChamada()).toBe(`${API}/health`)
    expect(opcoesChamada().method).toBe('GET')
  })

  it('envia JSON no corpo quando há dados', async () => {
    await api.api('/auth/onboarding', { method: 'POST', body: { institution_id: 7 } })

    expect(opcoesChamada().method).toBe('POST')
    expect(opcoesChamada().body).toBe('{"institution_id":7}')
    expect((opcoesChamada().headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('não envia corpo quando não há dados', async () => {
    await api.api('/health')

    expect(opcoesChamada().body).toBeUndefined()
  })

  it('anexa o token apenas quando a chamada pede autenticação', async () => {
    api.setToken('tok-1')

    await api.api('/auth/me', { auth: true })
    expect((opcoesChamada().headers as Record<string, string>).Authorization).toBe('Bearer tok-1')

    await api.api('/health')
    expect((opcoesChamada().headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('não anexa cabeçalho de autorização sem token guardado', async () => {
    await api.api('/auth/me', { auth: true })

    expect((opcoesChamada().headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('devolve o corpo da resposta', async () => {
    buscar.mockResolvedValue(respostaOk({ ok: true, now: '2026-10-26' }))

    expect(await api.api('/health')).toEqual({ ok: true, now: '2026-10-26' })
  })

  it.each([
    ['campo Error', { Error: 'Internal error' }, 'Internal error'],
    ['campo error', { error: 'forbidden' }, 'forbidden'],
  ])('propaga a mensagem de erro do %s', async (_rotulo, corpo, esperado) => {
    buscar.mockResolvedValue(respostaErro(400, corpo))

    await expect(api.api('/x')).rejects.toThrow(esperado)
  })

  it('usa o código HTTP quando o erro não traz mensagem', async () => {
    buscar.mockResolvedValue(respostaErro(503))

    await expect(api.api('/x')).rejects.toThrow('Erro 503')
  })

  it('resposta sem JSON válido não quebra a chamada bem-sucedida', async () => {
    buscar.mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('vazio') } })

    expect(await api.api('/x')).toBeNull()
  })
})

describe('apiForm', () => {
  it('envia o FormData sem forçar o tipo de conteúdo', async () => {
    const form = new FormData()
    form.append('file', new Blob(['x']), 'selo.png')

    await api.apiForm('/storage/seals', form)

    expect(opcoesChamada().method).toBe('POST')
    expect(opcoesChamada().body).toBe(form)
    expect(opcoesChamada().headers).toEqual({})
  })

  it('anexa o token quando existe', async () => {
    api.setToken('tok-1')

    await api.apiForm('/storage/seals', new FormData())

    expect(opcoesChamada().headers).toEqual({ Authorization: 'Bearer tok-1' })
  })

  it('propaga erro do servidor', async () => {
    buscar.mockResolvedValue(respostaErro(413, { error: 'arquivo_grande' }))

    await expect(api.apiForm('/storage/seals', new FormData())).rejects.toThrow('arquivo_grande')
  })
})

describe('geração de contrato', () => {
  it('enfileira o pedido autenticado', async () => {
    buscar.mockResolvedValue(respostaOk({ uuid: 'j-1', status: 'queued' }))
    api.setToken('tok-1')

    const job = await api.enqueueContract({ templateUuid: 't-1', values: { nome: 'ACME' } } as never)

    expect(urlChamada()).toBe(`${API}/storage/contracts`)
    expect(opcoesChamada().method).toBe('POST')
    expect(job.status).toBe('queued')
  })

  it('consulta o estado do pedido pelo identificador', async () => {
    buscar.mockResolvedValue(respostaOk({ uuid: 'j-1', status: 'done' }))

    await api.getContractJob('j-1')

    expect(urlChamada()).toBe(`${API}/storage/contracts/jobs/j-1`)
  })
})

describe('pollContractJob', () => {
  it('devolve assim que o pedido conclui', async () => {
    buscar.mockResolvedValue(respostaOk({ uuid: 'j-1', status: 'done' }))

    const job = await api.pollContractJob('j-1', { intervalMs: 1 })

    expect(job.status).toBe('done')
    expect(buscar).toHaveBeenCalledOnce()
  })

  it('devolve também quando o pedido falha', async () => {
    buscar.mockResolvedValue(respostaOk({ uuid: 'j-1', status: 'failed', error: 'x' }))

    expect((await api.pollContractJob('j-1', { intervalMs: 1 })).status).toBe('failed')
  })

  it('insiste enquanto o pedido está na fila', async () => {
    buscar
      .mockResolvedValueOnce(respostaOk({ status: 'queued' }))
      .mockResolvedValueOnce(respostaOk({ status: 'processing' }))
      .mockResolvedValueOnce(respostaOk({ status: 'done' }))

    expect((await api.pollContractJob('j-1', { intervalMs: 1 })).status).toBe('done')
    expect(buscar).toHaveBeenCalledTimes(3)
  })

  it('desiste depois do prazo', async () => {
    buscar.mockResolvedValue(respostaOk({ status: 'queued' }))

    await expect(api.pollContractJob('j-1', { intervalMs: 1, timeoutMs: -1 })).rejects.toThrow(
      'job_timeout',
    )
  })
})

describe('administração', () => {
  it('lista gestores', async () => {
    buscar.mockResolvedValue(respostaOk([{ uuid: 'u-1' }]))

    expect(await api.listManagers()).toEqual([{ uuid: 'u-1' }])
    expect(urlChamada()).toBe(`${API}/admin/managers`)
  })

  it('rebaixa gestor pelo identificador', async () => {
    await api.demoteManager('u-1')

    expect(urlChamada()).toBe(`${API}/admin/managers/u-1`)
    expect(opcoesChamada().method).toBe('DELETE')
  })

  it('lista convites', async () => {
    buscar.mockResolvedValue(respostaOk([{ email: 'a@b.com' }]))

    expect(await api.listManagerInvites()).toEqual([{ email: 'a@b.com' }])
  })

  it('convida por e-mail', async () => {
    buscar.mockResolvedValue(respostaOk({ email: 'novo@catolicasc.edu.br', promoted_now: false }))

    await api.inviteManager('novo@catolicasc.edu.br')

    expect(urlChamada()).toBe(`${API}/admin/manager-invites`)
    expect(opcoesChamada().method).toBe('POST')
    expect(opcoesChamada().body).toBe('{"email":"novo@catolicasc.edu.br"}')
  })

  it('revoga convite com o e-mail escapado na URL', async () => {
    await api.revokeManagerInvite('novo+teste@catolicasc.edu.br')

    expect(urlChamada()).toContain(encodeURIComponent('novo+teste@catolicasc.edu.br'))
    expect(opcoesChamada().method).toBe('DELETE')
  })
})

describe('trilha de auditoria', () => {
  it('sempre envia a página, começando na primeira', async () => {
    await api.listAuditLogs({})

    expect(urlChamada()).toBe(`${API}/admin/audit-logs?page=1`)
  })

  it('inclui apenas os filtros preenchidos', async () => {
    await api.listAuditLogs({ actor: 'ra.card', action: '', from: '2026-10-01', page: 3 })

    const params = new URL(urlChamada()).searchParams
    expect(params.get('page')).toBe('3')
    expect(params.get('actor')).toBe('ra.card')
    expect(params.get('from')).toBe('2026-10-01')
    expect(params.has('action')).toBe(false)
    expect(params.has('target')).toBe(false)
  })

  it('pede sugestões por campo e trecho', async () => {
    buscar.mockResolvedValue(respostaOk(['ra.cardoso@catolicasc.edu.br']))

    expect(await api.suggestAuditValues('actor', 'ra.card')).toEqual([
      'ra.cardoso@catolicasc.edu.br',
    ])

    const params = new URL(urlChamada()).searchParams
    expect(params.get('field')).toBe('actor')
    expect(params.get('q')).toBe('ra.card')
  })
})

describe('chancelas', () => {
  it('desembrulha a lista de chancelas', async () => {
    buscar.mockResolvedValue(respostaOk({ seals: [{ uuid: 's-1', name: 'Reitoria', itemId: 'i-1' }] }))

    expect(await api.listSeals()).toEqual([{ uuid: 's-1', name: 'Reitoria', itemId: 'i-1' }])
  })

  it('envia a chancela como arquivo de formulário', async () => {
    const arquivo = new File(['x'], 'selo.png', { type: 'image/png' })

    await api.uploadSeal(arquivo)

    expect(urlChamada()).toBe(`${API}/storage/seals`)
    expect(opcoesChamada().body).toBeInstanceOf(FormData)
    expect((opcoesChamada().body as FormData).get('file')).toBe(arquivo)
  })

  it('carimba o contrato com a posição escolhida', async () => {
    const entrada = { sealUuid: 's-1', xFrac: 0.1, yFracTop: 0.2, widthFrac: 0.3, page: 0, name: 'c' }

    await api.stampContract('i-1', entrada)

    expect(urlChamada()).toBe(`${API}/storage/contracts/i-1/stamp`)
    expect(JSON.parse(opcoesChamada().body as string)).toEqual(entrada)
  })
})

describe('arquivos', () => {
  const blobFalso = { size: 3, type: 'application/pdf' }

  beforeEach(() => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('transforma a resposta em URL de blob', async () => {
    buscar.mockResolvedValue({ ok: true, status: 200, blob: async () => blobFalso })

    expect(await api.fetchBlobUrl('/storage/download/i-1')).toBe('blob:fake')
  })

  it('devolve os bytes do arquivo', async () => {
    const bytes = new ArrayBuffer(8)
    buscar.mockResolvedValue({ ok: true, status: 200, arrayBuffer: async () => bytes })

    expect(await api.fetchBytes('/storage/download/i-1')).toBe(bytes)
  })

  it.each([
    ['fetchBlobUrl', () => api.fetchBlobUrl('/x')],
    ['fetchBytes', () => api.fetchBytes('/x')],
    ['downloadFile', () => api.downloadFile('/x', 'a.pdf')],
    ['viewFile', () => api.viewFile('/x')],
  ])('%s reporta falha do servidor', async (_rotulo, chamar) => {
    buscar.mockResolvedValue({ ok: false, status: 404 })

    await expect(chamar()).rejects.toThrow('Erro 404')
  })

  it('anexa o token nas chamadas de arquivo', async () => {
    api.setToken('tok-1')
    buscar.mockResolvedValue({ ok: true, status: 200, blob: async () => blobFalso })

    await api.fetchBlobUrl('/storage/download/i-1')

    expect(opcoesChamada().headers).toEqual({ Authorization: 'Bearer tok-1' })
  })

  it('dispara o download com o nome escolhido e limpa a URL', async () => {
    buscar.mockResolvedValue({ ok: true, status: 200, blob: async () => blobFalso })
    const clique = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await api.downloadFile('/storage/download/i-1', 'contrato.pdf')

    expect(clique).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('abre o arquivo em outra aba sem dar acesso à janela de origem', async () => {
    buscar.mockResolvedValue({ ok: true, status: 200, blob: async () => blobFalso })
    const abrir = vi.fn()
    vi.stubGlobal('open', abrir)

    await api.viewFile('/storage/download/i-1')

    expect(abrir).toHaveBeenCalledWith('blob:fake', '_blank', 'noopener')
  })
})
