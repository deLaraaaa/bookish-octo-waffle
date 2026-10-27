import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import Login from './Login'
import { renderizar, i18n } from '@/test/render'

beforeEach(async () => {
  await i18n.changeLanguage('pt')
})

describe('Login', () => {
  it('oferece a entrada pela conta Microsoft', () => {
    renderizar(<Login />)

    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', 'http://localhost:4000/auth/microsoft')
  })

  it('não mostra alerta quando não houve erro', () => {
    renderizar(<Login />)

    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('mostra a mensagem específica do erro conhecido', () => {
    renderizar(<Login />, { rota: '/login?error=domain_not_allowed' })

    const alerta = screen.getByRole('alert')
    expect(alerta).toBeInTheDocument()
    expect(alerta.textContent).not.toContain('login.errors')
  })

  it('erro desconhecido cai na mensagem genérica', () => {
    renderizar(<Login />, { rota: '/login?error=coisa_que_nao_existe' })

    const alerta = screen.getByRole('alert')
    expect(alerta.textContent).not.toContain('login.errors.coisa_que_nao_existe')
    expect(alerta.textContent?.length).toBeGreaterThan(0)
  })

  it('traduz a tela quando o idioma muda', async () => {
    const { unmount } = renderizar(<Login />)
    const emPortugues = screen.getByRole('link').textContent
    unmount()

    await i18n.changeLanguage('en')
    renderizar(<Login />)

    expect(screen.getByRole('link').textContent).not.toBe(emPortugues)
  })

  it('exibe o seletor de idioma', () => {
    renderizar(<Login />)

    expect(screen.getByTitle('Switch to English')).toBeInTheDocument()
  })
})
