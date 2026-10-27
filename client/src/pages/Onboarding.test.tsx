import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import Onboarding from './Onboarding'
import { AuthProvider } from '@/lib/auth'
import { setToken } from '@/lib/api'
import i18n from '@/i18n'
import { jsonErro, jsonOk, servidorFalso } from '@/test/api-mock'

const CONTA = {
  uuid: 'p-1',
  name: 'Rafael de Lara Cardoso',
  email: 'ra.cardoso@catolicasc.edu.br',
  role: 'TEACHER',
  onboarding_completed: false,
}

const UNIDADES = [
  { id: 1, uuid: 'i-1', name: 'Jaraguá do Sul' },
  { id: 2, uuid: 'i-2', name: 'Joinville' },
]

let buscar: ReturnType<typeof servidorFalso>

function montar() {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter
        initialEntries={['/onboarding']}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<div>catálogo</div>} />
            <Route path="/login" element={<div>login</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('pt')
  setToken('tok-1')
  buscar = servidorFalso({
    '/auth/me': () => jsonOk({ account: CONTA }),
    '/institutions': () => jsonOk(UNIDADES),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Onboarding', () => {
  it('lista as unidades disponíveis', async () => {
    montar()

    expect(await screen.findByText('Jaraguá do Sul')).toBeInTheDocument()
    expect(screen.getByText('Joinville')).toBeInTheDocument()
  })

  it('cumprimenta pelo primeiro nome', async () => {
    montar()

    await screen.findByText('Jaraguá do Sul')
    expect(document.body.textContent).toContain('Rafael')
    expect(document.body.textContent).not.toContain('Rafael de Lara Cardoso')
  })

  it('o envio começa desabilitado, até escolher uma unidade', async () => {
    const usuario = userEvent.setup()
    montar()

    await screen.findByText('Jaraguá do Sul')
    const enviar = screen.getByRole('button', { name: /continuar|salvar|avançar|concluir/i })
    expect(enviar).toBeDisabled()

    await usuario.click(screen.getByText('Jaraguá do Sul'))
    expect(enviar).toBeEnabled()
  })

  it('envia a unidade escolhida e segue para o catálogo', async () => {
    const usuario = userEvent.setup()
    montar()

    await screen.findByText('Joinville')
    await usuario.click(screen.getByText('Joinville'))
    await usuario.click(screen.getByRole('button', { name: /continuar|salvar|avançar|concluir/i }))

    await waitFor(() => {
      const envio = buscar.mock.calls.find(([url]) => String(url).includes('/auth/onboarding'))
      expect(envio).toBeDefined()
      expect(JSON.parse((envio![1] as RequestInit).body as string)).toEqual({ institution_id: 2 })
    })
  })

  it('avisa quando a lista de unidades não carrega', async () => {
    buscar = servidorFalso({
      '/auth/me': () => jsonOk({ account: CONTA }),
      '/institutions': () => jsonErro(500, { error: 'boom' }),
    })

    montar()

    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  it('avisa quando o envio falha, sem sair da tela', async () => {
    const usuario = userEvent.setup()
    buscar = servidorFalso({
      '/auth/me': () => jsonOk({ account: CONTA }),
      '/institutions': () => jsonOk(UNIDADES),
      '/auth/onboarding': () => jsonErro(500, { error: 'boom' }),
    })

    montar()

    await screen.findByText('Jaraguá do Sul')
    await usuario.click(screen.getByText('Jaraguá do Sul'))
    await usuario.click(screen.getByRole('button', { name: /continuar|salvar|avançar|concluir/i }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByText('catálogo')).toBeNull()
  })

  it('quem já concluiu o onboarding é mandado para o catálogo', async () => {
    buscar = servidorFalso({
      '/auth/me': () => jsonOk({ account: { ...CONTA, onboarding_completed: true } }),
    })

    montar()

    expect(await screen.findByText('catálogo')).toBeInTheDocument()
  })

  it('quem não está autenticado é mandado para o login', async () => {
    buscar = servidorFalso({ '/auth/me': () => jsonErro(401, { error: 'invalid_token' }) })

    montar()

    expect(await screen.findByText('login')).toBeInTheDocument()
  })
})
