import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import type { ReactElement, ReactNode } from 'react'
import i18n from '@/i18n'
import { AuthProvider } from '@/lib/auth'

type Opcoes = { rota?: string; comAuth?: boolean }

export function renderizar(ui: ReactElement, { rota = '/', comAuth = false }: Opcoes = {}) {
  const Envolver = ({ children }: { children: ReactNode }) => (
    <I18nextProvider i18n={i18n}>
      <MemoryRouter
        initialEntries={[rota]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {comAuth ? <AuthProvider>{children}</AuthProvider> : children}
      </MemoryRouter>
    </I18nextProvider>
  )

  return render(ui, { wrapper: Envolver })
}

export { i18n }
