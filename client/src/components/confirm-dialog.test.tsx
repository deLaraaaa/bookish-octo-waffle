import { beforeEach, describe, expect, it, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConfirmDialog } from './confirm-dialog'
import { renderizar, i18n } from '@/test/render'

const MOTIVO = {
  label: 'Motivo',
  hint: 'Fica na auditoria.',
  minLength: 5,
  tooShort: 'Descreva o motivo com pelo menos 5 caracteres.',
}

beforeEach(async () => {
  await i18n.changeLanguage('pt')
})

describe('ConfirmDialog', () => {
  it('não renderiza nada quando fechado', () => {
    const { container } = renderizar(
      <ConfirmDialog
        open={false}
        title="Recusar?"
        confirmLabel="Recusar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('mostra título e descrição da ação', () => {
    renderizar(
      <ConfirmDialog
        open
        title="Recusar Kohlbach?"
        description="A empresa sai da fila."
        confirmLabel="Recusar"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Recusar Kohlbach?')).toBeInTheDocument()
    expect(screen.getByText('A empresa sai da fila.')).toBeInTheDocument()
  })

  it('confirma sem motivo quando o campo não é pedido', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.fn()
    renderizar(
      <ConfirmDialog open title="Aprovar?" confirmLabel="Aprovar" onConfirm={confirmar} onCancel={vi.fn()} />
    )

    await usuario.click(screen.getByRole('button', { name: 'Aprovar' }))

    expect(confirmar).toHaveBeenCalledWith('')
  })

  it('bloqueia a confirmação enquanto o motivo está vazio', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.fn()
    renderizar(
      <ConfirmDialog
        open
        title="Recusar?"
        confirmLabel="Recusar"
        reason={MOTIVO}
        onConfirm={confirmar}
        onCancel={vi.fn()}
      />
    )

    await usuario.click(screen.getByRole('button', { name: 'Recusar' }))

    expect(confirmar).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent(MOTIVO.tooShort)
  })

  it('bloqueia motivo curto demais para explicar algo', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.fn()
    renderizar(
      <ConfirmDialog
        open
        title="Recusar?"
        confirmLabel="Recusar"
        reason={MOTIVO}
        onConfirm={confirmar}
        onCancel={vi.fn()}
      />
    )

    await usuario.type(screen.getByLabelText(/Motivo/), 'nao')
    await usuario.click(screen.getByRole('button', { name: 'Recusar' }))

    expect(confirmar).not.toHaveBeenCalled()
  })

  it('devolve o motivo sem espaços sobrando', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.fn()
    renderizar(
      <ConfirmDialog
        open
        title="Recusar?"
        confirmLabel="Recusar"
        reason={MOTIVO}
        onConfirm={confirmar}
        onCancel={vi.fn()}
      />
    )

    await usuario.type(screen.getByLabelText(/Motivo/), '  CNPJ sem atividade  ')
    await usuario.click(screen.getByRole('button', { name: 'Recusar' }))

    expect(confirmar).toHaveBeenCalledWith('CNPJ sem atividade')
  })

  it('cancela pelo botão e pela tecla Escape', async () => {
    const usuario = userEvent.setup()
    const cancelar = vi.fn()
    renderizar(
      <ConfirmDialog open title="Recusar?" confirmLabel="Recusar" onConfirm={vi.fn()} onCancel={cancelar} />
    )

    await usuario.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(cancelar).toHaveBeenCalledTimes(1)

    await usuario.keyboard('{Escape}')
    expect(cancelar).toHaveBeenCalledTimes(2)
  })

  it('desabilita os botões enquanto a ação roda', () => {
    renderizar(
      <ConfirmDialog open busy title="Recusar?" confirmLabel="Recusar" onConfirm={vi.fn()} onCancel={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: 'Recusar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()
  })

  it('limpa o motivo digitado ao reabrir', async () => {
    const usuario = userEvent.setup()
    const props = {
      title: 'Recusar?',
      confirmLabel: 'Recusar',
      reason: MOTIVO,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    }
    const { rerender } = renderizar(<ConfirmDialog open {...props} />)

    await usuario.type(screen.getByLabelText(/Motivo/), 'CNPJ sem atividade')
    rerender(<ConfirmDialog open={false} {...props} />)
    rerender(<ConfirmDialog open {...props} />)

    expect(screen.getByLabelText(/Motivo/)).toHaveValue('')
  })
})
