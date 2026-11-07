import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportButton } from './export-button'
import { renderizar, i18n } from '@/test/render'

beforeEach(async () => {
  await i18n.changeLanguage('pt')
})

describe('ExportButton', () => {
  it('mostra o rótulo padrão', () => {
    renderizar(<ExportButton onExport={vi.fn().mockResolvedValue(undefined)} />)

    expect(screen.getByRole('button')).toHaveTextContent('Exportar')
  })

  it('aceita rótulo próprio', () => {
    renderizar(<ExportButton onExport={vi.fn().mockResolvedValue(undefined)} label="Baixar tudo" />)

    expect(screen.getByRole('button')).toHaveTextContent('Baixar tudo')
  })

  it('chama a exportação ao clicar', async () => {
    const usuario = userEvent.setup()
    const exportar = vi.fn().mockResolvedValue(undefined)
    renderizar(<ExportButton onExport={exportar} />)

    await usuario.click(screen.getByRole('button'))

    expect(exportar).toHaveBeenCalledTimes(1)
  })

  it('bloqueia cliques repetidos enquanto gera', async () => {
    const usuario = userEvent.setup()
    let liberar: () => void = () => {}
    const exportar = vi.fn(() => new Promise<void>((r) => { liberar = r }))
    renderizar(<ExportButton onExport={exportar} />)

    await usuario.click(screen.getByRole('button'))
    expect(screen.getByRole('button')).toBeDisabled()

    await usuario.click(screen.getByRole('button'))
    expect(exportar).toHaveBeenCalledTimes(1)

    liberar()
  })

  it('avisa enquanto está gerando', async () => {
    const usuario = userEvent.setup()
    let liberar: () => void = () => {}
    renderizar(<ExportButton onExport={() => new Promise<void>((r) => { liberar = r })} />)

    await usuario.click(screen.getByRole('button'))

    expect(screen.getByRole('button')).toHaveTextContent('Gerando')
    liberar()
  })

  it('volta ao estado normal quando falha', async () => {
    const usuario = userEvent.setup()
    renderizar(<ExportButton onExport={vi.fn().mockRejectedValue(new Error('500'))} />)

    await usuario.click(screen.getByRole('button'))

    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled())
    expect(screen.getByRole('button')).toHaveTextContent('Exportar')
  })
})
