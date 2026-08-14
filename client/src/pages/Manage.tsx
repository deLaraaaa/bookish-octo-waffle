import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { api, type Institution, type MyEnterprise, type Paginated } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LanguageSwitcher } from '@/components/language-switcher'
import { MyEnterpriseRow } from '@/components/enterprise-list'
import { Logo } from '@/style'

type EnterpriseStatus = 'pending' | 'active' | 'suspended' | 'inactive'
const STATUS_OPTIONS: EnterpriseStatus[] = ['pending', 'active', 'suspended', 'inactive']

export default function Manage() {
  const { t } = useTranslation()
  const { account, logout } = useAuth()

  const [cities, setCities] = useState<string[]>([])
  const [openUuid, setOpenUuid] = useState<string | null>(null)
  const [busyUuid, setBusyUuid] = useState<string | null>(null)

  // ---- Todas as empresas (busca + cidade + status + paginação) ----
  const [all, setAll] = useState<MyEnterprise[]>([])
  const [allLoading, setAllLoading] = useState(true)
  const [allError, setAllError] = useState(false)
  const [allSearchInput, setAllSearchInput] = useState('')
  const [allSearch, setAllSearch] = useState('')
  const [allCity, setAllCity] = useState('')
  const [allStatus, setAllStatus] = useState('')
  const [allPage, setAllPage] = useState(1)
  const [allHasMore, setAllHasMore] = useState(false)

  // ---- Pendentes de aprovação (busca + paginação) ----
  const [pending, setPending] = useState<MyEnterprise[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingError, setPendingError] = useState(false)
  const [pendingSearchInput, setPendingSearchInput] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [pendingPage, setPendingPage] = useState(1)
  const [pendingHasMore, setPendingHasMore] = useState(false)

  // Busca/filtro/paginação no backend, não no frontend.
  async function fetchAll(search: string, page: number, city: string, status: string) {
    setAllLoading(true)
    setAllError(false)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (search) params.set('search', search)
      if (city) params.set('city', city)
      if (status) params.set('status', status)
      const data = await api<Paginated<MyEnterprise>>(`/enterprises/manage?${params}`, { auth: true })
      setAll(data.items)
      setAllHasMore(data.hasMore)
      setAllPage(data.page)
      setAllSearch(search)
    } catch {
      setAllError(true)
    } finally {
      setAllLoading(false)
    }
  }

  async function fetchPending(search: string, page: number) {
    setPendingLoading(true)
    setPendingError(false)
    try {
      const params = new URLSearchParams({ page: String(page) })
      if (search) params.set('search', search)
      const data = await api<Paginated<MyEnterprise>>(`/enterprises/pending?${params}`, { auth: true })
      setPending(data.items)
      setPendingHasMore(data.hasMore)
      setPendingPage(data.page)
      setPendingSearch(search)
    } catch {
      setPendingError(true)
    } finally {
      setPendingLoading(false)
    }
  }

  useEffect(() => {
    async function loadCities() {
      try {
        const insts = await api<Institution[]>('/institutions', { auth: true })
        setCities(Array.from(new Set(insts.map((i) => i.name).filter(Boolean))))
      } catch {
        // O filtro de cidade é opcional; a lista funciona sem ele.
      }
    }
    loadCities()
    fetchAll('', 1, '', '')
    fetchPending('', 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Transição de estado (aprovar/suspender/etc); recarrega as duas listas
  // preservando os filtros/paginação atuais.
  async function setStatus(uuid: string, status: EnterpriseStatus) {
    setBusyUuid(uuid)
    try {
      await api(`/enterprises/${uuid}/status`, { method: 'PATCH', body: { status }, auth: true })
      await Promise.all([
        fetchAll(allSearch, allPage, allCity, allStatus),
        fetchPending(pendingSearch, pendingPage),
      ])
    } catch {
      setAllError(true)
    } finally {
      setBusyUuid(null)
    }
  }

  function actionsFor(e: MyEnterprise) {
    const status = e.status as EnterpriseStatus
    const busy = busyUuid === e.uuid
    if (status === 'pending') {
      return [
        <Button key="approve" size="sm" disabled={busy} onClick={() => setStatus(e.uuid, 'active')}>
          {t('manage.actions.approve')}
        </Button>,
        <Button key="reject" size="sm" variant="outline" disabled={busy} onClick={() => setStatus(e.uuid, 'inactive')}>
          {t('manage.actions.reject')}
        </Button>,
      ]
    }
    if (status === 'active') {
      return [
        <Button key="suspend" size="sm" variant="outline" disabled={busy} onClick={() => setStatus(e.uuid, 'suspended')}>
          {t('manage.actions.suspend')}
        </Button>,
      ]
    }
    return [
      <Button key="activate" size="sm" disabled={busy} onClick={() => setStatus(e.uuid, 'active')}>
        {t('manage.actions.activate')}
      </Button>,
    ]
  }

  const toggle = (uuid: string) => setOpenUuid((cur) => (cur === uuid ? null : uuid))

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <h1 className="text-lg font-semibold">{t('manage.title')}</h1>
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

      <main className="container space-y-10 py-8">
        {/* ===================== Pendentes de aprovação ===================== */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">{t('manage.pending.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('manage.pending.description')}</p>
          </div>

          {/* Só campo de busca */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setOpenUuid(null)
              fetchPending(pendingSearchInput.trim(), 1)
            }}
            className="mb-4 flex gap-2 sm:max-w-md"
          >
            <Input
              value={pendingSearchInput}
              onChange={(e) => setPendingSearchInput(e.target.value)}
              placeholder={t('home.catalog.searchPlaceholder')}
            />
            <Button type="submit" disabled={pendingLoading}>
              <Search className="mr-1 h-4 w-4" />
              {t('home.catalog.search')}
            </Button>
            {pendingSearch && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPendingSearchInput('')
                  setOpenUuid(null)
                  fetchPending('', 1)
                }}
              >
                {t('home.catalog.clear')}
              </Button>
            )}
          </form>

          {pendingLoading ? (
            <p className="text-sm text-muted-foreground">{t('manage.loading')}</p>
          ) : pendingError ? (
            <p className="text-sm text-destructive">{t('manage.loadError')}</p>
          ) : pending.length === 0 ? (
            <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
              {pendingSearch ? t('home.catalog.emptySearch') : t('manage.pending.empty')}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {pending.map((e) => (
                  <MyEnterpriseRow
                    key={e.uuid}
                    enterprise={e}
                    open={openUuid === e.uuid}
                    onToggle={() => toggle(e.uuid)}
                    actions={actionsFor(e)}
                  />
                ))}
              </ul>
              <Pager
                page={pendingPage}
                hasMore={pendingHasMore}
                loading={pendingLoading}
                onPage={(p) => {
                  if (p < 1 || pendingLoading) return
                  setOpenUuid(null)
                  fetchPending(pendingSearch, p)
                }}
              />
            </>
          )}
        </section>

        {/* ===================== Todas as empresas ===================== */}
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">{t('manage.all.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('manage.all.description')}</p>
          </div>

          {/* Busca + cidade + status */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setOpenUuid(null)
                fetchAll(allSearchInput.trim(), 1, allCity, allStatus)
              }}
              className="flex flex-1 gap-2 sm:max-w-md"
            >
              <Input
                value={allSearchInput}
                onChange={(e) => setAllSearchInput(e.target.value)}
                placeholder={t('home.catalog.searchPlaceholder')}
              />
              <Button type="submit" disabled={allLoading}>
                <Search className="mr-1 h-4 w-4" />
                {t('home.catalog.search')}
              </Button>
              {allSearch && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAllSearchInput('')
                    setOpenUuid(null)
                    fetchAll('', 1, allCity, allStatus)
                  }}
                >
                  {t('home.catalog.clear')}
                </Button>
              )}
            </form>

            {cities.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="manage-city" className="whitespace-nowrap text-sm font-medium">
                  {t('home.catalog.cityFilter')}
                </label>
                <select
                  id="manage-city"
                  value={allCity}
                  onChange={(e) => {
                    const v = e.target.value
                    setAllCity(v)
                    setOpenUuid(null)
                    fetchAll(allSearch, 1, v, allStatus)
                  }}
                  disabled={allLoading}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
                >
                  <option value="">{t('home.catalog.allCities')}</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="flex items-center gap-2">
              <label htmlFor="manage-status" className="whitespace-nowrap text-sm font-medium">
                {t('manage.statusFilter')}
              </label>
              <select
                id="manage-status"
                value={allStatus}
                onChange={(e) => {
                  const v = e.target.value
                  setAllStatus(v)
                  setOpenUuid(null)
                  fetchAll(allSearch, 1, allCity, v)
                }}
                disabled={allLoading}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
              >
                <option value="">{t('manage.allStatuses')}</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {t(`enterpriseStatus.${s}`)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {allLoading ? (
            <p className="text-sm text-muted-foreground">{t('manage.loading')}</p>
          ) : allError ? (
            <p className="text-sm text-destructive">{t('manage.loadError')}</p>
          ) : all.length === 0 ? (
            <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
              {allSearch ? t('home.catalog.emptySearch') : t('manage.all.empty')}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {all.map((e) => (
                  <MyEnterpriseRow
                    key={e.uuid}
                    enterprise={e}
                    open={openUuid === e.uuid}
                    onToggle={() => toggle(e.uuid)}
                    actions={actionsFor(e)}
                  />
                ))}
              </ul>
              <Pager
                page={allPage}
                hasMore={allHasMore}
                loading={allLoading}
                onPage={(p) => {
                  if (p < 1 || allLoading) return
                  setOpenUuid(null)
                  fetchAll(allSearch, p, allCity, allStatus)
                }}
              />
            </>
          )}
        </section>
      </main>
    </div>
  )
}

// Paginação (10/página, controlada pelo backend), igual à da Home.
function Pager({
  page,
  hasMore,
  loading,
  onPage,
}: {
  page: number
  hasMore: boolean
  loading: boolean
  onPage: (page: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
        <ChevronLeft className="mr-1 h-4 w-4" />
        {t('home.catalog.prev')}
      </Button>
      <span className="text-sm text-muted-foreground">{t('home.catalog.page', { page })}</span>
      <Button variant="outline" size="sm" disabled={!hasMore || loading} onClick={() => onPage(page + 1)}>
        {t('home.catalog.next')}
        <ChevronRight className="ml-1 h-4 w-4" />
      </Button>
    </div>
  )
}
