import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText, MapPin, Phone, Plus, Search, User } from 'lucide-react'
import { api, type Contract, type Enterprise, type MyEnterprise } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LanguageSwitcher } from '@/components/language-switcher'
import { EnterpriseFormModal } from '@/components/enterprise-form-modal'
import { Logo } from '@/style'
import { cn } from '@/lib/utils'

const OTHER = '__other__'

// Normaliza cidade para comparar/agrupar (sem acento, minúsculo, sem espaços nas pontas).
function normCity(city?: string | null): string {
  return (city || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
}

type CityGroup = { key: string; label: string; items: Enterprise[] }

export default function Home() {
  const { t } = useTranslation()
  const { account, logout } = useAuth()

  // Catálogo público
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [activeCity, setActiveCity] = useState<string | null>(null)
  const [openUuid, setOpenUuid] = useState<string | null>(null)

  // Minhas empresas (criadas pelo usuário)
  const [mine, setMine] = useState<MyEnterprise[]>([])
  const [mineError, setMineError] = useState(false)
  const [openMineUuid, setOpenMineUuid] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  async function fetchMine() {
    try {
      const data = await api<MyEnterprise[]>('/enterprises/mine', { auth: true })
      setMine(data)
      setMineError(false)
    } catch {
      setMineError(true)
    }
  }

  // Busca no backend (endpoint), não no frontend.
  async function fetchCatalog(search: string) {
    setLoading(true)
    setError(false)
    try {
      const qs = search ? `?search=${encodeURIComponent(search)}` : ''
      const data = await api<Enterprise[]>(`/enterprises${qs}`, { auth: true })
      setEnterprises(data)
      setAppliedSearch(search)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCatalog('')
    fetchMine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setOpenUuid(null)
    fetchCatalog(searchInput.trim())
  }

  function onClearSearch() {
    setSearchInput('')
    setOpenUuid(null)
    fetchCatalog('')
  }

  // Agrupa o resultado do catálogo por cidade (vinda da instituição).
  const groups = useMemo<CityGroup[]>(() => {
    const map = new Map<string, CityGroup>()
    for (const e of enterprises) {
      const raw = e.city?.trim() || ''
      const key = raw ? normCity(raw) : OTHER
      const label = raw || t('home.catalog.otherCity')
      const g = map.get(key)
      if (g) g.items.push(e)
      else map.set(key, { key, label, items: [e] })
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }, [enterprises, t])

  // Mantém a cidade ativa se ainda existir; senão escolhe a cidade de origem da
  // conta (fallback: primeira aba).
  useEffect(() => {
    if (groups.length === 0) {
      setActiveCity(null)
      return
    }
    setActiveCity((cur) => {
      if (cur && groups.some((g) => g.key === cur)) return cur
      const origin = normCity(account?.institution_city)
      const match = groups.find((g) => g.key === origin)
      return match ? match.key : groups[0].key
    })
  }, [groups, account?.institution_city])

  const activeGroup = groups.find((g) => g.key === activeCity) ?? null
  const roleSuffix = account?.role ? ` · ${t(`roles.${account.role}`)}` : ''

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <h1 className="text-lg font-semibold">{t('common.appName')}</h1>
              <p className="text-sm text-muted-foreground">
                {account?.name}
                {roleSuffix}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="outline" size="sm" onClick={logout}>
              {t('home.logout')}
            </Button>
          </div>
        </div>
      </header>

      <main className="container space-y-10 py-8">
        {/* ===================== Minhas empresas ===================== */}
        <section>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{t('home.mine.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('home.mine.description')}</p>
            </div>
            <Button onClick={() => setFormOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              {t('home.mine.register')}
            </Button>
          </div>
          {mineError ? (
            <p className="text-sm text-destructive">{t('home.mine.loadError')}</p>
          ) : mine.length === 0 ? (
            <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
              {t('home.mine.noContracts')}
            </p>
          ) : (
            <ul className="space-y-2">
              {mine.map((e) => (
                <MyEnterpriseRow
                  key={e.uuid}
                  enterprise={e}
                  open={openMineUuid === e.uuid}
                  onToggle={() =>
                    setOpenMineUuid((cur) => (cur === e.uuid ? null : e.uuid))
                  }
                />
              ))}
            </ul>
          )}
        </section>

        <EnterpriseFormModal
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onCreated={fetchMine}
        />

        {/* ===================== Empresas parceiras ===================== */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">{t('home.catalog.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('home.catalog.description')}</p>
          </div>

          {/* Busca via endpoint (campo + botão) */}
          <form onSubmit={onSearchSubmit} className="mb-4 flex gap-2 sm:max-w-md">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('home.catalog.searchPlaceholder')}
            />
            <Button type="submit" disabled={loading}>
              <Search className="mr-1 h-4 w-4" />
              {t('home.catalog.search')}
            </Button>
            {appliedSearch && (
              <Button type="button" variant="ghost" onClick={onClearSearch}>
                {t('home.catalog.clear')}
              </Button>
            )}
          </form>

          {loading ? (
            <p className="text-sm text-muted-foreground">{t('home.catalog.loading')}</p>
          ) : error ? (
            <p className="text-sm text-destructive">{t('home.catalog.loadError')}</p>
          ) : (
            <>
              {groups.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-2">
                  {groups.map((g) => (
                    <Button
                      key={g.key}
                      variant={g.key === activeCity ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => {
                        setActiveCity(g.key)
                        setOpenUuid(null)
                      }}
                    >
                      {g.label}
                      <span
                        className={cn(
                          'ml-2 rounded-full px-1.5 text-xs',
                          g.key === activeCity
                            ? 'bg-primary-foreground/20'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {g.items.length}
                      </span>
                    </Button>
                  ))}
                </div>
              )}

              {!activeGroup || activeGroup.items.length === 0 ? (
                <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
                  {appliedSearch ? t('home.catalog.emptySearch') : t('home.catalog.empty')}
                </p>
              ) : (
                <ul className="space-y-2">
                  {activeGroup.items.map((e) => (
                    <EnterpriseRow
                      key={e.uuid}
                      enterprise={e}
                      open={openUuid === e.uuid}
                      onToggle={() =>
                        setOpenUuid((cur) => (cur === e.uuid ? null : e.uuid))
                      }
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}

function formatAddress(e: {
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
}): string {
  const line = [e.street, e.number].filter(Boolean).join(', ')
  const rest = [e.neighborhood, e.city, e.state].filter(Boolean).join(' · ')
  return [line, rest].filter(Boolean).join(' — ')
}

function EnterpriseRow({
  enterprise: e,
  open,
  onToggle,
}: {
  enterprise: Enterprise
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const na = t('home.catalog.notProvided')
  const address = formatAddress(e)

  return (
    <li className="overflow-hidden rounded-lg border bg-background">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{e.name}</p>
          <p className="truncate text-sm text-muted-foreground">{address || na}</p>
        </div>
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            open && 'rotate-90'
          )}
        />
      </button>

      {open && (
        <dl className="grid gap-3 border-t px-4 py-3 text-sm sm:grid-cols-2">
          <Detail icon={MapPin} label={t('home.catalog.address')} value={address || na} />
          <Detail icon={User} label={t('home.catalog.responsible')} value={e.responsible_person || na} />
          <Detail icon={Phone} label={t('home.catalog.phone')} value={e.phone_number || na} />
        </dl>
      )}
    </li>
  )
}

function MyEnterpriseRow({
  enterprise: e,
  open,
  onToggle,
}: {
  enterprise: MyEnterprise
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const na = t('home.catalog.notProvided')
  const address = formatAddress(e)

  return (
    <li className="overflow-hidden rounded-lg border bg-background">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
      >
        <div className="min-w-0">
          <p className="truncate font-medium">{e.name}</p>
          <p className="truncate text-sm text-muted-foreground">{address || na}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {e.status !== 'active' && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {t('home.mine.pending')}
            </span>
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t('home.mine.contractCount', { count: e.contracts.length })}
          </span>
          <ChevronRight
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              open && 'rotate-90'
            )}
          />
        </div>
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-3">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail icon={MapPin} label={t('home.catalog.address')} value={address || na} />
            <Detail icon={User} label={t('home.catalog.responsible')} value={e.responsible_person || na} />
            <Detail icon={Phone} label={t('home.catalog.phone')} value={e.phone_number || na} />
          </dl>

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('home.mine.contracts')}
            </h4>
            {e.contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('home.mine.noContracts')}</p>
            ) : (
              <ul className="space-y-2">
                {e.contracts.map((c) => (
                  <ContractItem key={c.uuid} contract={c} />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

function docStatusClasses(status: string): string {
  switch (status) {
    case 'signed':
      return 'bg-green-100 text-green-800'
    case 'pending':
      return 'bg-amber-100 text-amber-800'
    case 'refused':
      return 'bg-red-100 text-red-800'
    case 'expired':
      return 'bg-orange-100 text-orange-800'
    case 'draft':
    case 'archived':
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

function ContractItem({ contract: c }: { contract: Contract }) {
  const { t, i18n } = useTranslation()
  const due = c.due_date
    ? new Date(c.due_date).toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'pt-BR')
    : null

  return (
    <li className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{c.name}</p>
          <p className="text-xs text-muted-foreground">
            {c.signature_status
              ? t(`home.sigStatus.${c.signature_status}`, { defaultValue: c.signature_status })
              : t('home.mine.signature')}
            {due ? ` · ${t('home.mine.due')} ${due}` : ''}
          </p>
        </div>
      </div>
      <span
        className={cn(
          'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
          docStatusClasses(c.status)
        )}
      >
        {t(`home.docStatus.${c.status}`, { defaultValue: c.status })}
      </span>
    </li>
  )
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPin
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="break-words">{value}</dd>
      </div>
    </div>
  )
}
