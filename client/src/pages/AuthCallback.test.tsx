import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import AuthCallback from './AuthCallback'
import { AuthProvider } from '@/lib/auth'
import { getToken } from '@/lib/api'
import i18n from '@/i18n'

let buscar: ReturnType<typeof vi.fn>

beforeEach(async () => {
  await i18n.changeLanguage('pt')
  buscar = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ account: { uuid: 'p-1', name: 'Rafael', onboarding_completed: true } }),
  })
  vi.stubGlobal('fetch', buscar)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function montar(rota: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter
        initialEntries={[rota]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <AuthProvider>
          <Routes>
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/" element={<div>catálogo</div>} />
            <Route path="/onboarding" element={<div>onboarding</div>} />
            <Route path="/login" element={<div>login</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    </I18nextProvider>,
  )
}

describe('AuthCallback', () => {
  it('sem token, volta para o login sinalizando falha', async () => {
    montar('/auth/callback')

    await waitFor(() => expect(screen.getByText('login')).toBeInTheDocument())
    expect(getToken()).toBeNull()
  })

  it('guarda o token recebido e leva ao catálogo', async () => {
    montar('/auth/callback?token=tok-1')

    await waitFor(() => expect(screen.getByText('catálogo')).toBeInTheDocument())
    expect(getToken()).toBe('tok-1')
  })

  it('conta sem onboarding concluído vai para o onboarding', async () => {
    buscar.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ account: { uuid: 'p-1', name: 'Rafael', onboarding_completed: false } }),
    })

    montar('/auth/callback?token=tok-1')

    await waitFor(() => expect(screen.getByText('onboarding')).toBeInTheDocument())
  })

  it('token recusado também cai no onboarding, sem conta carregada', async () => {
    buscar.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'invalid_token' }) })

    montar('/auth/callback?token=tok-vencido')

    await waitFor(() => expect(screen.getByText('onboarding')).toBeInTheDocument())
    expect(getToken()).toBeNull()
  })
})
