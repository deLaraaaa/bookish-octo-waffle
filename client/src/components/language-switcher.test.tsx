import { beforeEach, describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LanguageSwitcher } from './language-switcher'
import { renderizar, i18n } from '@/test/render'

beforeEach(async () => {
  await i18n.changeLanguage('pt')
})

describe('LanguageSwitcher', () => {
  it('mostra o idioma atual em maiúsculas', () => {
    renderizar(<LanguageSwitcher />)

    expect(screen.getByRole('button')).toHaveTextContent('PT')
  })

  it('alterna para inglês e de volta', async () => {
    const usuario = userEvent.setup()
    renderizar(<LanguageSwitcher />)

    await usuario.click(screen.getByRole('button'))
    expect(i18n.resolvedLanguage).toBe('en')
    expect(screen.getByRole('button')).toHaveTextContent('EN')

    await usuario.click(screen.getByRole('button'))
    expect(i18n.resolvedLanguage).toBe('pt')
  })

  it('o rótulo de ajuda anuncia o próximo idioma', async () => {
    renderizar(<LanguageSwitcher />)

    expect(screen.getByRole('button')).toHaveAttribute('title', 'Switch to English')

    await i18n.changeLanguage('en')
    renderizar(<LanguageSwitcher />)
    expect(screen.getAllByRole('button').at(-1)).toHaveAttribute(
      'title',
      'Mudar para Português',
    )
  })

  it('aceita classes adicionais sem perder as próprias', () => {
    renderizar(<LanguageSwitcher className="absolute right-4" />)

    const botao = screen.getByRole('button')
    expect(botao.className).toContain('absolute')
    expect(botao.className).toContain('text-muted-foreground')
  })
})
