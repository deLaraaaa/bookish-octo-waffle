import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bell, Loader2 } from 'lucide-react'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type ContractNotification,
} from '@/lib/api'
import { daysSince, waitToneClasses } from '@/lib/time'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

const RECARGA_MS = 5 * 60 * 1000

function toneFor(milestone: ContractNotification['milestone']) {
  if (milestone === '1_semana') return 'late'
  if (milestone === '1_mes') return 'warn'
  return 'fresh'
}

export function NotificationBell() {
  const { t, i18n } = useTranslation()
  const [itens, setItens] = useState<ContractNotification[]>([])
  const [naoLidas, setNaoLidas] = useState(0)
  const [aberto, setAberto] = useState(false)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState(false)
  const caixa = useRef<HTMLDivElement>(null)

  async function carregar() {
    setCarregando(true)
    setErro(false)
    try {
      const d = await fetchNotifications()
      setItens(d.items)
      setNaoLidas(d.unread)
    } catch {
      setErro(true)
    } finally {
      setCarregando(false)
    }
  }

  useEffect(() => {
    carregar()
    const timer = window.setInterval(carregar, RECARGA_MS)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!aberto) return
    const fora = (e: MouseEvent) => {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false)
    document.addEventListener('mousedown', fora)
    window.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', fora)
      window.removeEventListener('keydown', esc)
    }
  }, [aberto])

  async function abrirItem(n: ContractNotification) {
    if (n.read) return
    setItens((cur) => cur.map((x) => (x.uuid === n.uuid ? { ...x, read: true } : x)))
    setNaoLidas((c) => Math.max(0, c - 1))
    try {
      await markNotificationRead(n.uuid)
    } catch {
      carregar()
    }
  }

  async function lerTodas() {
    setItens((cur) => cur.map((x) => ({ ...x, read: true })))
    setNaoLidas(0)
    try {
      await markAllNotificationsRead()
    } catch {
      carregar()
    }
  }

  const rotulo = naoLidas > 0 ? t('notifications.withUnread', { count: naoLidas }) : t('notifications.title')

  return (
    <div className="relative" ref={caixa}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={rotulo}
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
        className="relative"
      >
        <Bell className="h-4 w-4" />
        {naoLidas > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground">
            {naoLidas > 99 ? '99+' : naoLidas}
          </span>
        )}
      </Button>

      {aberto && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border bg-background shadow-lg sm:w-96">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-sm font-semibold">{t('notifications.title')}</span>
            {naoLidas > 0 && (
              <button
                type="button"
                onClick={lerTodas}
                className="text-xs text-primary underline-offset-2 hover:underline"
              >
                {t('notifications.markAll')}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {carregando && itens.length === 0 ? (
              <p className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('common.loading')}
              </p>
            ) : erro ? (
              <p className="px-4 py-8 text-center text-sm text-destructive">
                {t('notifications.error')}
              </p>
            ) : itens.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t('notifications.empty')}
              </p>
            ) : (
              <ul className="divide-y">
                {itens.map((n) => {
                  const dias = daysSince(n.due_date) === null ? null : -1 * (daysSince(n.due_date) ?? 0)
                  const vence = new Date(n.due_date).toLocaleDateString(
                    i18n.language === 'en' ? 'en-US' : 'pt-BR'
                  )
                  return (
                    <li key={n.uuid}>
                      <button
                        type="button"
                        onClick={() => abrirItem(n)}
                        className={cn(
                          'flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50',
                          !n.read && 'bg-primary/5'
                        )}
                      >
                        {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                        <span className={cn('min-w-0 flex-1', n.read && 'pl-5')}>
                          <span className="block truncate text-sm font-medium">
                            {n.enterprise_name ?? n.document_name ?? t('notifications.unnamed')}
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {t(`notifications.milestone.${n.milestone}`)} · {t('notifications.dueOn', { date: vence })}
                          </span>
                        </span>
                        <span
                          className={cn(
                            'shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-medium',
                            waitToneClasses(toneFor(n.milestone))
                          )}
                        >
                          {dias !== null && dias >= 0 ? t('notifications.inDays', { count: dias }) : vence}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
