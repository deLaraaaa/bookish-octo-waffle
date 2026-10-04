import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search, UserMinus, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  demoteManager,
  inviteManager,
  listAuditLogs,
  listManagerInvites,
  listManagers,
  revokeManagerInvite,
  suggestAuditValues,
  type AuditLog,
  type AuditSearchField,
  type Manager,
  type ManagerInvite,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Logo } from '@/style'

// Ações conhecidas da trilha — espelha o que o backend grava em audit_log.action.
const AUDIT_ACTIONS = [
  'manager.invite',
  'manager.invite_revoke',
  'manager.demote',
  'enterprise.create',
  'enterprise.status',
  'contract.generate',
  'contract.link',
  'contract.status',
  'contract.stamp',
  'seal.create',
  'template.import',
  'template.sync',
] as const

// Um filtro por coluna da tabela de auditoria, combináveis entre si.
type AuditFilters = {
  actor: string
  target: string
  action: string
  from: string
  to: string
}

const EMPTY_FILTERS: AuditFilters = { actor: '', target: '', action: '', from: '', to: '' }

export default function Admin() {
  const { t } = useTranslation()
  const { account, logout } = useAuth()

  const [tab, setTab] = useState<'accounts' | 'audit'>('accounts')

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <h1 className="text-lg font-semibold">{t('admin.title')}</h1>
              <p className="text-sm text-muted-foreground">{account?.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/">
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t('manage.backToCatalog')}
              </Link>
            </Button>
            <LanguageSwitcher />
            <Button variant="outline" size="sm" onClick={logout}>
              {t('home.logout')}
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="mb-6 flex gap-6 border-b">
          {(['accounts', 'audit'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={
                'relative -mb-px border-b-2 px-1 pb-3 text-sm font-medium transition-colors ' +
                (tab === key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground')
              }
            >
              {t(`admin.tabs.${key}`)}
            </button>
          ))}
        </div>

        {tab === 'accounts' && <AccountsTab />}
        {tab === 'audit' && <AuditTab />}
      </main>
    </div>
  )
}

// ===================== Contas & Gestores =====================
function AccountsTab() {
  const { t } = useTranslation()

  const [managers, setManagers] = useState<Manager[]>([])
  const [invites, setInvites] = useState<ManagerInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [email, setEmail] = useState('')
  const [inviting, setInviting] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(false)
    try {
      const [m, i] = await Promise.all([listManagers(), listManagerInvites()])
      setManagers(m)
      setInvites(i)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onInvite(e: React.FormEvent) {
    e.preventDefault()
    const value = email.trim().toLowerCase()
    if (!value) return
    setInviting(true)
    try {
      const result = await inviteManager(value)
      toast.success(
        result.promoted_now ? t('admin.invite.promotedNow') : t('admin.invite.success'),
      )
      setEmail('')
      load()
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      toast.error(t(`admin.invite.errors.${code}`, t('admin.invite.errors.generic')))
    } finally {
      setInviting(false)
    }
  }

  async function onDemote(m: Manager) {
    if (!window.confirm(t('admin.managers.demoteConfirm', { name: m.name }))) return
    setBusy(m.uuid)
    try {
      await demoteManager(m.uuid)
      toast.success(t('admin.managers.demoted'))
      load()
    } catch {
      toast.error(t('admin.managers.demoteError'))
    } finally {
      setBusy(null)
    }
  }

  async function onRevoke(invite: ManagerInvite) {
    setBusy(invite.email)
    try {
      await revokeManagerInvite(invite.email)
      toast.success(t('admin.invites.revoked'))
      load()
    } catch {
      toast.error(t('admin.invites.revokeError'))
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <p className="text-sm text-muted-foreground">{t('admin.loading')}</p>
  if (error) return <p className="text-sm text-destructive">{t('admin.loadError')}</p>

  return (
    <div className="space-y-10">
      {/* Convite por e-mail: a regra (domínio, promoção na hora) fica no backend. */}
      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold">{t('admin.invite.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('admin.invite.description')}</p>
        </div>
        <form onSubmit={onInvite} className="flex gap-2 sm:max-w-md">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('admin.invite.placeholder')}
            required
          />
          <Button type="submit" disabled={inviting || !email.trim()}>
            <UserPlus className="mr-1 h-4 w-4" />
            {inviting ? t('admin.invite.submitting') : t('admin.invite.submit')}
          </Button>
        </form>
      </section>

      {/* Gestores com papel persistido hoje. */}
      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold">{t('admin.managers.title')}</h2>
        </div>
        {managers.length === 0 ? (
          <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
            {t('admin.managers.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {managers.map((m) => (
              <li
                key={m.uuid}
                className="flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{m.name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {m.email || t('admin.managers.noEmail')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === m.uuid}
                  onClick={() => onDemote(m)}
                >
                  <UserMinus className="mr-1 h-4 w-4" />
                  {t('admin.managers.demote')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Convites (allowlist): pendentes de primeiro login ou já consumidos. */}
      <section>
        <div className="mb-4">
          <h2 className="text-xl font-semibold">{t('admin.invites.title')}</h2>
        </div>
        {invites.length === 0 ? (
          <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
            {t('admin.invites.empty')}
          </p>
        ) : (
          <ul className="space-y-2">
            {invites.map((i) => (
              <li
                key={i.email}
                className="flex items-center justify-between gap-3 rounded-lg border bg-background px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{i.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {i.consumed ? t('admin.invites.consumed') : t('admin.invites.pendingUse')}
                    {' · '}
                    {new Date(i.invited_at).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === i.email}
                  onClick={() => onRevoke(i)}
                >
                  <X className="mr-1 h-4 w-4" />
                  {t('admin.invites.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

// ===================== Auditoria =====================
function AuditTab() {
  const { t } = useTranslation()

  const [items, setItems] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)

  // Rascunho (o que está nos campos) separado do aplicado (o que foi buscado) —
  // a paginação continua usando os filtros aplicados mesmo com os campos sujos.
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_FILTERS)

  const setFilter = (patch: Partial<AuditFilters>) =>
    setDraft((cur) => ({ ...cur, ...patch }))

  async function fetchLogs(filters: AuditFilters, nextPage: number) {
    setLoading(true)
    setError(false)
    try {
      const data = await listAuditLogs({ ...filters, page: nextPage })
      setItems(data.items)
      setHasMore(data.hasMore)
      setPage(data.page)
      setApplied(filters)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs(EMPTY_FILTERS, 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const hasFilters = Object.values(applied).some(Boolean)

  // Chaves i18n não podem conter ponto (é separador) — vira underline.
  const actionLabel = (a: string) =>
    t(`admin.audit.actions.${a.replace(/\./g, '_')}`, a)

  // Texto auxiliar do registro: de→para nos status, contadores na mescla etc.
  function detailText(log: AuditLog): string | null {
    const d = log.detail || {}
    if (log.action === 'enterprise.status' && d.from && d.to) {
      return `${t(`enterpriseStatus.${d.from}`, String(d.from))} → ${t(`enterpriseStatus.${d.to}`, String(d.to))}`
    }
    if (log.action === 'contract.status' && d.to) {
      const to = t(`home.docStatus.${d.to}`, String(d.to))
      return d.from ? `${t(`home.docStatus.${d.from}`, String(d.from))} → ${to}` : to
    }
    if (log.action === 'manager.invite' && d.promoted_now) {
      return t('admin.audit.promotedNow')
    }
    if (log.action === 'enterprise.create' && d.cnpj) {
      return `CNPJ ${d.cnpj}`
    }
    if (log.action === 'template.sync') {
      return t('admin.audit.syncDetail', {
        added: Array.isArray(d.added) ? d.added.length : 0,
        removed: Array.isArray(d.removed) ? d.removed.length : 0,
      })
    }
    return null
  }

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">{t('admin.audit.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('admin.audit.description')}</p>
      </div>

      {/* Um filtro por coluna da tabela, combináveis entre si (AND). */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          fetchLogs(draft, 1)
        }}
        className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3"
      >
        <div>
          <label className="mb-1 block text-sm font-medium">{t('admin.audit.when')}</label>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={draft.from}
              onChange={(e) => setFilter({ from: e.target.value })}
              className="w-fit"
            />
            <span className="text-sm text-muted-foreground">–</span>
            <Input
              type="date"
              value={draft.to}
              onChange={(e) => setFilter({ to: e.target.value })}
              className="w-fit"
            />
          </div>
        </div>

        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-sm font-medium">{t('admin.audit.who')}</label>
          <SuggestInput
            field="actor"
            value={draft.actor}
            onChange={(v) => setFilter({ actor: v })}
            placeholder={t('admin.audit.placeholders.actor')}
          />
        </div>

        <div>
          <label htmlFor="audit-action" className="mb-1 block text-sm font-medium">
            {t('admin.audit.actionCol')}
          </label>
          <select
            id="audit-action"
            value={draft.action}
            onChange={(e) => setFilter({ action: e.target.value })}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">{t('admin.audit.allActions')}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-56 flex-1">
          <label className="mb-1 block text-sm font-medium">{t('admin.audit.target')}</label>
          <SuggestInput
            field="target"
            value={draft.target}
            onChange={(v) => setFilter({ target: v })}
            placeholder={t('admin.audit.placeholders.target')}
          />
        </div>

        <div className="flex gap-2">
          <Button type="submit" disabled={loading}>
            <Search className="mr-1 h-4 w-4" />
            {t('home.catalog.search')}
          </Button>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(EMPTY_FILTERS)
                fetchLogs(EMPTY_FILTERS, 1)
              }}
            >
              {t('home.catalog.clear')}
            </Button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-muted-foreground">{t('admin.loading')}</p>
      ) : error ? (
        <p className="text-sm text-destructive">{t('admin.loadError')}</p>
      ) : items.length === 0 ? (
        <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
          {t('admin.audit.empty')}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border bg-background">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t('admin.audit.when')}</th>
                  <th className="px-4 py-2 font-medium">{t('admin.audit.who')}</th>
                  <th className="px-4 py-2 font-medium">{t('admin.audit.actionCol')}</th>
                  <th className="px-4 py-2 font-medium">{t('admin.audit.target')}</th>
                  <th className="px-4 py-2 font-medium">{t('admin.audit.detail')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr key={log.id} className="border-b last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {new Date(log.insert_date).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">{log.actor_email || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2">{actionLabel(log.action)}</td>
                    <td className="px-4 py-2">{log.entity_ref || '—'}</td>
                    <td className="px-4 py-2 text-muted-foreground">{detailText(log) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => fetchLogs(applied, page - 1)}
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              {t('home.catalog.prev')}
            </Button>
            <span className="text-sm text-muted-foreground">{t('home.catalog.page', { page })}</span>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore || loading}
              onClick={() => fetchLogs(applied, page + 1)}
            >
              {t('home.catalog.next')}
              <ChevronRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </>
      )}
    </section>
  )
}

// Input com autocomplete de valores já registrados na trilha (debounce 250ms,
// mínimo 2 letras). Selecionar uma sugestão só preenche o campo — a busca
// continua sendo disparada pelo submit do formulário de filtros.
function SuggestInput({
  field,
  value,
  onChange,
  placeholder,
}: {
  field: AuditSearchField
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const skip = useRef(false) // seleção não deve reabrir a lista

  useEffect(() => {
    if (skip.current) {
      skip.current = false
      return
    }
    const q = value.trim()
    if (q.length < 2) {
      setSuggestions([])
      setOpen(false)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const values = await suggestAuditValues(field, q)
        setSuggestions(values)
        setOpen(values.length > 0)
      } catch {
        setSuggestions([])
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [value, field])

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(suggestions.length > 0)}
        onBlur={() => setOpen(false)}
        placeholder={placeholder}
      />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-md border bg-background shadow-md">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                // onMouseDown: dispara antes do blur do input fechar a lista.
                onMouseDown={(e) => {
                  e.preventDefault()
                  skip.current = true
                  onChange(s)
                  setOpen(false)
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
