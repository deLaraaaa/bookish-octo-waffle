import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { jsonErro, jsonOk, servidorFalso } from '@/test/api-mock'
import { setToken } from '@/lib/api'
import i18n from '@/i18n'

vi.mock('@/pages/Home', () => ({ default: () => <div>pagina inicial</div> }))
vi.mock('@/pages/Manage', () => ({ default: () => <div>gestao</div> }))
vi.mock('@/pages/Admin', () => ({ default: () => <div>administracao</div> }))

const App = (await import('./App')).default

const conta = (extras: Record<string, unknown> = {}) => ({
  uuid: 'p-1',
  name: 'Rafael',
  email: 'ra.cardoso@catolicasc.edu.br',
  role: 'TEACHER',
  onboarding_completed: true,
  ...extras,
})

function montar(rota: string) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter
        initialEntries={[rota]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

beforeEach(async () => {
  await i18n.changeLanguage('pt')
  servidorFalso({ '/institutions': () => jsonOk([]) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rotas públicas', () => {
  it('a tela de login é acessível sem sessão', async () => {
    montar('/login')

    expect(await screen.findByRole('link')).toBeInTheDocument()
  })

  it('rota desconhecida cai na inicial', async () => {
    setToken('tok-1')
    servidorFalso({ '/auth/me': () => jsonOk({ account: conta() }) })

    montar('/rota-que-nao-existe')

    expect(await screen.findByText('pagina inicial')).toBeInTheDocument()
  })
})

describe('guarda de rota', () => {
  it('sem sessão, qualquer rota protegida manda para o login', async () => {
    montar('/')

    expect(await screen.findByRole('link')).toBeInTheDocument()
    expect(screen.queryByText('pagina inicial')).toBeNull()
  })

  it('token recusado também manda para o login', async () => {
    setToken('tok-vencido')
    servidorFalso({ '/auth/me': () => jsonErro(401, { error: 'invalid_token' }) })

    montar('/')

    expect(await screen.findByRole('link')).toBeInTheDocument()
  })

  it('quem não concluiu o onboarding é levado para ele', async () => {
    setToken('tok-1')
    servidorFalso({
      '/auth/me': () => jsonOk({ account: conta({ onboarding_completed: false }) }),
      '/institutions': () => jsonOk([{ id: 1, uuid: 'i-1', name: 'Jaraguá do Sul' }]),
    })

    montar('/')

    expect(await screen.findByText('Jaraguá do Sul')).toBeInTheDocument()
  })

  it('conta completa entra na inicial', async () => {
    setToken('tok-1')
    servidorFalso({ '/auth/me': () => jsonOk({ account: conta() }) })

    montar('/')

    expect(await screen.findByText('pagina inicial')).toBeInTheDocument()
  })
})

describe('restrição por papel', () => {
  it.each([
    ['TEACHER', '/manage'],
    ['STUDENT', '/manage'],
    ['MANAGER', '/admin'],
    ['TEACHER', '/admin'],
  ])('papel %s não entra em %s', async (role, rota) => {
    setToken('tok-1')
    servidorFalso({ '/auth/me': () => jsonOk({ account: conta({ role }) }) })

    montar(rota)

    expect(await screen.findByText('pagina inicial')).toBeInTheDocument()
  })

  it.each([['MANAGER'], ['ADMIN']])('papel %s entra na gestão', async (role) => {
    setToken('tok-1')
    servidorFalso({ '/auth/me': () => jsonOk({ account: conta({ role }) }) })

    montar('/manage')

    expect(await screen.findByText('gestao')).toBeInTheDocument()
  })

  it('só o papel ADMIN entra na administração', async () => {
    setToken('tok-1')
    servidorFalso({ '/auth/me': () => jsonOk({ account: conta({ role: 'ADMIN' }) }) })

    montar('/admin')

    expect(await screen.findByText('administracao')).toBeInTheDocument()
  })

  it('conta sem papel nenhum não entra em rota restrita', async () => {
    setToken('tok-1')
    servidorFalso({ '/auth/me': () => jsonOk({ account: conta({ role: null }) }) })

    montar('/manage')

    expect(await screen.findByText('pagina inicial')).toBeInTheDocument()
  })
})
