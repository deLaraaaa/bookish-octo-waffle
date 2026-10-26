import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthProvider, useAuth } from './auth'
import { getToken, setToken } from './api'

const CONTA = {
  uuid: 'p-1',
  name: 'Rafael de Lara',
  email: 'ra.cardoso@catolicasc.edu.br',
  role: 'MANAGER',
  onboarding_completed: true,
}

let buscar: ReturnType<typeof vi.fn>

beforeEach(() => {
  buscar = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ account: CONTA }),
  })
  vi.stubGlobal('fetch', buscar)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function Sonda() {
  const { account, loading, refresh, logout } = useAuth()
  return (
    <div>
      <span data-testid="estado">{loading ? 'carregando' : 'pronto'}</span>
      <span data-testid="conta">{account ? account.name : 'sem conta'}</span>
      <button onClick={() => refresh()}>atualizar</button>
      <button onClick={logout}>sair</button>
    </div>
  )
}

const montar = () =>
  render(
    <AuthProvider>
      <Sonda />
    </AuthProvider>,
  )

const estado = () => screen.getByTestId('estado').textContent
const conta = () => screen.getByTestId('conta').textContent

describe('AuthProvider', () => {
  it('sem token guardado, encerra o carregamento sem conta', async () => {
    montar()

    await waitFor(() => expect(estado()).toBe('pronto'))
    expect(conta()).toBe('sem conta')
    expect(buscar).not.toHaveBeenCalled()
  })

  it('com token válido, carrega a conta', async () => {
    setToken('tok-1')
    montar()

    await waitFor(() => expect(conta()).toBe('Rafael de Lara'))
    expect(estado()).toBe('pronto')
  })

  it('envia o token na consulta da conta', async () => {
    setToken('tok-1')
    montar()

    await waitFor(() => expect(buscar).toHaveBeenCalled())
    const [url, opcoes] = buscar.mock.calls[0]
    expect(url).toContain('/auth/me')
    expect((opcoes.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
  })

  it('token recusado pelo servidor é descartado', async () => {
    setToken('tok-vencido')
    buscar.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'invalid_token' }) })

    montar()

    await waitFor(() => expect(estado()).toBe('pronto'))
    expect(conta()).toBe('sem conta')
    expect(getToken()).toBeNull()
  })

  it('falha de rede também limpa a sessão', async () => {
    setToken('tok-1')
    buscar.mockRejectedValue(new Error('offline'))

    montar()

    await waitFor(() => expect(estado()).toBe('pronto'))
    expect(getToken()).toBeNull()
  })

  it('logout limpa token e conta', async () => {
    const usuario = userEvent.setup()
    setToken('tok-1')
    montar()

    await waitFor(() => expect(conta()).toBe('Rafael de Lara'))
    await usuario.click(screen.getByRole('button', { name: 'sair' }))

    expect(conta()).toBe('sem conta')
    expect(getToken()).toBeNull()
  })

  it('refresh recarrega a conta sob demanda', async () => {
    const usuario = userEvent.setup()
    setToken('tok-1')
    montar()

    await waitFor(() => expect(conta()).toBe('Rafael de Lara'))
    const antes = buscar.mock.calls.length

    await usuario.click(screen.getByRole('button', { name: 'atualizar' }))

    await waitFor(() => expect(buscar.mock.calls.length).toBe(antes + 1))
  })
})

describe('useAuth fora do provedor', () => {
  it('falha com mensagem explícita', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => render(<Sonda />)).toThrow('useAuth must be used within AuthProvider')
  })
})
