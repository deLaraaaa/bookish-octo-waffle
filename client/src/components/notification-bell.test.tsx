import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NotificationBell } from './notification-bell'
import { renderizar, i18n } from '@/test/render'
import * as api from '@/lib/api'

const AVISO = {
  uuid: 'n-1',
  milestone: '1_mes' as const,
  due_date: '2026-12-01T00:00:00.000Z',
  insert_date: '2026-10-30T00:00:00.000Z',
  document_uuid: 'd-1',
  document_name: 'Convenio 2026',
  enterprise_uuid: 'e-1',
  enterprise_name: 'Kohlbach Motores',
  read: false,
}

let buscar: MockInstance<typeof api.fetchNotifications>
let marcar: MockInstance<typeof api.markNotificationRead>
let marcarTodas: MockInstance<typeof api.markAllNotificationsRead>

beforeEach(async () => {
  await i18n.changeLanguage('pt')
  buscar = vi.spyOn(api, 'fetchNotifications').mockResolvedValue({ items: [], unread: 0 })
  marcar = vi.spyOn(api, 'markNotificationRead').mockResolvedValue({ uuid: 'n-1', read: true })
  marcarTodas = vi.spyOn(api, 'markAllNotificationsRead').mockResolvedValue({ marked: 1 })
})

describe('NotificationBell', () => {
  it('busca os avisos ao montar', async () => {
    renderizar(<NotificationBell />)

    await waitFor(() => expect(buscar).toHaveBeenCalled())
  })

  it('não mostra contador quando está tudo lido', async () => {
    renderizar(<NotificationBell />)

    await waitFor(() => expect(buscar).toHaveBeenCalled())
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('mostra o número de avisos não lidos', async () => {
    buscar.mockResolvedValue({ items: [AVISO], unread: 3 })
    renderizar(<NotificationBell />)

    expect(await screen.findByText('3')).toBeInTheDocument()
  })

  it('abrevia contagem acima de 99', async () => {
    buscar.mockResolvedValue({ items: [], unread: 150 })
    renderizar(<NotificationBell />)

    expect(await screen.findByText('99+')).toBeInTheDocument()
  })

  it('a lista só aparece depois do clique', async () => {
    const usuario = userEvent.setup()
    buscar.mockResolvedValue({ items: [AVISO], unread: 1 })
    renderizar(<NotificationBell />)

    await waitFor(() => expect(buscar).toHaveBeenCalled())
    expect(screen.queryByText('Kohlbach Motores')).not.toBeInTheDocument()

    await usuario.click(screen.getByRole('button'))
    expect(await screen.findByText('Kohlbach Motores')).toBeInTheDocument()
  })

  it('mostra estado vazio quando não há avisos', async () => {
    const usuario = userEvent.setup()
    renderizar(<NotificationBell />)

    await waitFor(() => expect(buscar).toHaveBeenCalled())
    await usuario.click(screen.getByRole('button'))

    expect(await screen.findByText(/Nenhum contrato/)).toBeInTheDocument()
  })

  it('avisa quando a busca falha', async () => {
    const usuario = userEvent.setup()
    buscar.mockRejectedValue(new Error('rede'))
    renderizar(<NotificationBell />)

    await waitFor(() => expect(buscar).toHaveBeenCalled())
    await usuario.click(screen.getByRole('button'))

    expect(await screen.findByText(/Não foi possível carregar/)).toBeInTheDocument()
  })

  it('clicar num aviso marca como lido e baixa o contador', async () => {
    const usuario = userEvent.setup()
    buscar.mockResolvedValue({ items: [AVISO], unread: 1 })
    renderizar(<NotificationBell />)

    await usuario.click(await screen.findByRole('button'))
    await usuario.click(await screen.findByText('Kohlbach Motores'))

    await waitFor(() => expect(marcar).toHaveBeenCalledWith('n-1'))
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('não rechama a API para aviso já lido', async () => {
    const usuario = userEvent.setup()
    buscar.mockResolvedValue({ items: [{ ...AVISO, read: true }], unread: 0 })
    renderizar(<NotificationBell />)

    await usuario.click(await screen.findByRole('button'))
    await usuario.click(await screen.findByText('Kohlbach Motores'))

    expect(marcar).not.toHaveBeenCalled()
  })

  it('marca todos como lidos', async () => {
    const usuario = userEvent.setup()
    buscar.mockResolvedValue({ items: [AVISO], unread: 1 })
    renderizar(<NotificationBell />)

    await usuario.click(await screen.findByRole('button'))
    await usuario.click(await screen.findByText('Marcar todos como lidos'))

    await waitFor(() => expect(marcarTodas).toHaveBeenCalled())
  })

  it('usa o nome do documento quando não há empresa vinculada', async () => {
    const usuario = userEvent.setup()
    buscar.mockResolvedValue({ items: [{ ...AVISO, enterprise_name: null }], unread: 1 })
    renderizar(<NotificationBell />)

    await usuario.click(await screen.findByRole('button'))

    expect(await screen.findByText('Convenio 2026')).toBeInTheDocument()
  })

  it('fecha com Escape', async () => {
    const usuario = userEvent.setup()
    buscar.mockResolvedValue({ items: [AVISO], unread: 1 })
    renderizar(<NotificationBell />)

    await usuario.click(await screen.findByRole('button'))
    expect(await screen.findByText('Kohlbach Motores')).toBeInTheDocument()

    await usuario.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByText('Kohlbach Motores')).not.toBeInTheDocument())
  })
})
