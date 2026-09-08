import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileText, Link2, Loader2, X } from 'lucide-react'
import { api, type LinkableContract } from '@/lib/api'
import { Button } from '@/components/ui/button'

type Props = {
  enterprise: { uuid: string; name: string } | null
  onClose: () => void
  onLinked: () => void
}

export function LinkContractModal({ enterprise, onClose, onLinked }: Props) {
  const { t } = useTranslation()
  const open = enterprise !== null

  const [items, setItems] = useState<LinkableContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [linking, setLinking] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setError(false)
    api<{ contracts: LinkableContract[] }>('/storage/contracts/unlinked', { auth: true })
      .then((d) => setItems(d.contracts))
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !enterprise) return null

  async function link(c: LinkableContract) {
    setLinking(c.itemId)
    try {
      await api('/storage/contracts/link', {
        method: 'POST',
        auth: true,
        body: { enterpriseUuid: enterprise!.uuid, itemId: c.itemId, name: c.name },
      })
      toast.success(t('templates.link.success'))
      setItems((cur) => cur.filter((x) => x.itemId !== c.itemId))
      onLinked()
    } catch {
      toast.error(t('templates.link.error'))
    } finally {
      setLinking(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-background shadow-xl">
        <div className="flex items-center gap-3 bg-primary px-5 py-4 text-primary-foreground">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{t('templates.link.title')}</h2>
            <p className="truncate text-xs opacity-80">
              {t('templates.link.fromEnterprise', { name: enterprise.name })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="fechar" className="ml-auto shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-5">
          <p className="mb-3 text-sm text-muted-foreground">{t('templates.link.description')}</p>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('manage.loading')}</p>
          ) : error ? (
            <p className="text-sm text-destructive">{t('templates.link.loadError')}</p>
          ) : items.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('templates.link.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {items.map((c) => (
                <li key={c.itemId} className="flex items-center gap-3 rounded-md border p-3">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</p>
                  <Button size="sm" disabled={linking === c.itemId} onClick={() => link(c)}>
                    {linking === c.itemId ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Link2 className="mr-1 h-4 w-4" />
                    )}
                    {t('templates.link.link')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
