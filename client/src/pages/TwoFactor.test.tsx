import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import TwoFactor from './TwoFactor'
import { AuthProvider } from '@/lib/auth'
import { getToken } from '@/lib/api'
import i18n from '@/i18n'
import { jsonErro, jsonOk, servidorFalso } from '@/test/api-mock'

const CONTA = { uuid: 'p-1', name: 'Rafael', onboarding_completed: true }

let buscar: ReturnType<typeof servidorFalso>

function montar(rota = '/2fa?challenge=desafio-1') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter
        initialEntries={[rota]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <Routes>
            <Route path="/2fa" element={<TwoFactor />} />
            <Route path="/" element={<div>catálogo</div>} />
            <Route path="/onboarding" element={<div>onboarding</div>} />
            <Route path="/login" element={<div>login</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

const campoDoCodigo = () => document.querySelector('input') as HTMLInputElement

beforeEach(async () => {
  await i18n.changeLanguage('pt')
  buscar = servidorFalso({
    '/auth/2fa/verify': () => jsonOk({ token: 'tok-sessao' }),
    '/auth/2fa/resend': () => jsonOk({ ok: true }),
    '/auth/me': () => jsonOk({ account: CONTA }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('sem desafio na URL', () => {
  it('explica que o link é inválido e oferece voltar ao login', () => {
    montar('/2fa')

    expect(screen.getByRole('link')).toHaveAttribute('href', '/login')
    expect(campoDoCodigo()).toBeNull()
  })
})

describe('verificação do código', () => {
  it('o botão de verificar só habilita com os quatro dígitos', async () => {
    const usuario = userEvent.setup()
    montar()

    const verificar = screen.getByRole('button', { name: /verificar/i })
    expect(verificar).toBeDisabled()

    await usuario.type(campoDoCodigo(), '12')
    expect(verificar).toBeDisabled()
  })

  it('completar os quatro dígitos envia sozinho', async () => {
    const usuario = userEvent.setup()
    montar()

    await usuario.type(campoDoCodigo(), '1234')

    await waitFor(() => {
      const envio = buscar.mock.calls.find(([url]) => String(url).includes('/auth/2fa/verify'))
      expect(JSON.parse((envio![1] as RequestInit).body as string)).toEqual({
        challenge: 'desafio-1',
        code: '1234',
      })
    })
  })

  it('código correto guarda a sessão e entra no catálogo', async () => {
    const usuario = userEvent.setup()
    montar()

    await usuario.type(campoDoCodigo(), '1234')

    expect(await screen.findByText('catálogo')).toBeInTheDocument()
    expect(getToken()).toBe('tok-sessao')
  })

  it('conta sem onboarding vai para o onboarding', async () => {
    const usuario = userEvent.setup()
    buscar = servidorFalso({
      '/auth/2fa/verify': () => jsonOk({ token: 'tok-sessao' }),
      '/auth/me': () => jsonOk({ account: { ...CONTA, onboarding_completed: false } }),
    })
    montar()

    await usuario.type(campoDoCodigo(), '1234')

    expect(await screen.findByText('onboarding')).toBeInTheDocument()
  })

  it.each([
    ['expirado', 'expired'],
    ['errado', 'invalid'],
    ['tentativas esgotadas', 'too_many_attempts'],
  ])('mostra o aviso quando o código está %s', async (_rotulo, motivo) => {
    const usuario = userEvent.setup()
    buscar = servidorFalso({
      '/auth/2fa/verify': () => jsonErro(401, { error: motivo }),
      '/auth/me': () => jsonOk({ account: CONTA }),
    })
    montar()

    await usuario.type(campoDoCodigo(), '1234')

    const alerta = await screen.findByRole('alert')
    expect(alerta.textContent).not.toContain('twoFactor.errors')
    expect(alerta.textContent?.length).toBeGreaterThan(0)
  })

  it('limpa o campo depois de um código recusado', async () => {
    const usuario = userEvent.setup()
    buscar = servidorFalso({
      '/auth/2fa/verify': () => jsonErro(401, { error: 'invalid' }),
      '/auth/me': () => jsonOk({ account: CONTA }),
    })
    montar()

    await usuario.type(campoDoCodigo(), '1234')

    await waitFor(() => expect(campoDoCodigo().value).toBe(''))
  })
})

describe('reenvio do código', () => {
  it('logo após abrir a tela, mostra a contagem em vez do botão', () => {
    montar()

    expect(screen.queryByRole('button', { name: /reenviar/i })).toBeNull()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('passado o tempo de espera, o reenvio fica disponível', async () => {
    vi.useFakeTimers()
    montar()

    await vi.advanceTimersByTimeAsync(31_000)

    expect(screen.getByRole('button', { name: /reenviar/i })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('reenviar pede um novo código e reinicia a espera', async () => {
    vi.useFakeTimers()
    montar()

    await vi.advanceTimersByTimeAsync(31_000)
    fireEvent.click(screen.getByRole('button', { name: /reenviar/i }))

    await vi.waitFor(() =>
      expect(buscar.mock.calls.some(([url]) => String(url).includes('/auth/2fa/resend'))).toBe(true),
    )
    await vi.waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument())
  })

  it('avisa quando o reenvio falha', async () => {
    vi.useFakeTimers()
    buscar = servidorFalso({
      '/auth/2fa/resend': () => jsonErro(500, { error: 'boom' }),
      '/auth/me': () => jsonOk({ account: CONTA }),
    })
    montar()

    await vi.advanceTimersByTimeAsync(31_000)
    fireEvent.click(screen.getByRole('button', { name: /reenviar/i }))

    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })
})
