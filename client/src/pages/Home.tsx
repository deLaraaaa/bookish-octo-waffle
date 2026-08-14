import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus, Search, ShieldCheck } from 'lucide-react'
import {
  api,
  type Enterprise,
  type Institution,
  type MyEnterprise,
  type Paginated,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LanguageSwitcher } from '@/components/language-switcher'
import { EnterpriseFormModal } from '@/components/enterprise-form-modal'
import { EnterpriseRow, MyEnterpriseRow } from '@/components/enterprise-list'
import { Logo } from '@/style'

export default function Home() {
  const { t } = useTranslation()
  const { account, logout } = useAuth()

  // Catálogo público (paginado: 10 por página, controlado pelo backend)
  const [enterprises, setEnterprises] = useState<Enterprise[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [openUuid, setOpenUuid] = useState<string | null>(null)
  // Filtro por cidade de origem — opções vêm da tabela institution.
  const [cities, setCities] = useState<string[]>([])
  const [city, setCity] = useState('')

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

  // Busca, filtro de cidade e paginação no backend (endpoint), não no frontend.
  async function fetchCatalog(search: string, nextPage: number, cityFilter: string) {
    setLoading(true)
    setError(false)
    try {
      const params = new URLSearchParams({ page: String(nextPage) })
      if (search) params.set('search', search)
      if (cityFilter) params.set('city', cityFilter)
      const data = await api<Paginated<Enterprise>>(`/enterprises?${params}`, { auth: true })
      setEnterprises(data.items)
      setHasMore(data.hasMore)
      setPage(data.page)
      setAppliedSearch(search)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    async function init() {
      // Carrega as cidades (nomes das instituições) e escolhe como padrão a
      // cidade de origem da conta, quando ela está entre as opções.
      let initialCity = ''
      try {
        const insts = await api<Institution[]>('/institutions', { auth: true })
        const names = Array.from(new Set(insts.map((i) => i.name).filter(Boolean)))
        setCities(names)
        const accountCity = account?.institution_name ?? ''
        initialCity = accountCity && names.includes(accountCity) ? accountCity : ''
        setCity(initialCity)
      } catch {
        // Sem cidades: o catálogo continua funcionando sem o filtro.
      }
      fetchCatalog('', 1, initialCity)
    }
    init()
    fetchMine()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setOpenUuid(null)
    fetchCatalog(searchInput.trim(), 1, city) // nova busca sempre volta à página 1
  }

  function onClearSearch() {
    setSearchInput('')
    setOpenUuid(null)
    fetchCatalog('', 1, city)
  }

  // Troca de cidade: volta à página 1 e recarrega do backend.
  function onCityChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    setCity(next)
    setOpenUuid(null)
    fetchCatalog(appliedSearch, 1, next)
  }

  // Troca de página: mantém busca e cidade aplicadas e recarrega do backend.
  function goToPage(nextPage: number) {
    if (nextPage < 1 || loading) return
    setOpenUuid(null)
    fetchCatalog(appliedSearch, nextPage, city)
  }

  const roleSuffix = account?.role ? ` · ${t(`roles.${account.role}`)}` : ''
  const canManage = account?.role === 'MANAGER' || account?.role === 'ADMIN'
  // Professor tem acesso de leitura aos contratos de todas as empresas.
  const canViewContracts = canManage || account?.role === 'TEACHER'

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
            {canManage && (
              <Button asChild variant="outline" size="sm">
                <Link to="/manage">
                  <ShieldCheck className="mr-1 h-4 w-4" />
                  {t('manage.navLink')}
                </Link>
              </Button>
            )}
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

          {/* Barra de busca + filtro de cidade, lado a lado (quebra em telas estreitas) */}
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* Busca via endpoint (campo + botão) */}
            <form onSubmit={onSearchSubmit} className="flex flex-1 gap-2 sm:max-w-md">
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

            {/* Filtro por cidade de origem (opções da tabela institution) */}
            {cities.length > 0 && (
              <div className="flex items-center gap-2">
                <label htmlFor="city-filter" className="whitespace-nowrap text-sm font-medium">
                  {t('home.catalog.cityFilter')}
                </label>
                <select
                  id="city-filter"
                  value={city}
                  onChange={onCityChange}
                  disabled={loading}
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
          </div>

          {loading ? (
            <p className="text-sm text-muted-foreground">{t('home.catalog.loading')}</p>
          ) : error ? (
            <p className="text-sm text-destructive">{t('home.catalog.loadError')}</p>
          ) : enterprises.length === 0 ? (
            <p className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
              {appliedSearch ? t('home.catalog.emptySearch') : t('home.catalog.empty')}
            </p>
          ) : (
            <>
              <ul className="space-y-2">
                {enterprises.map((e) => {
                  const onToggle = () =>
                    setOpenUuid((cur) => (cur === e.uuid ? null : e.uuid))
                  // Professor/gestão veem a empresa com seus contratos (linha
                  // expansível); aluno vê só os dados públicos.
                  return canViewContracts ? (
                    <MyEnterpriseRow
                      key={e.uuid}
                      enterprise={e}
                      open={openUuid === e.uuid}
                      onToggle={onToggle}
                    />
                  ) : (
                    <EnterpriseRow
                      key={e.uuid}
                      enterprise={e}
                      open={openUuid === e.uuid}
                      onToggle={onToggle}
                    />
                  )
                })}
              </ul>

              {/* Paginação: 10 por página, controlada pelo backend */}
              <div className="mt-4 flex items-center justify-between gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => goToPage(page - 1)}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t('home.catalog.prev')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('home.catalog.page', { page })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!hasMore || loading}
                  onClick={() => goToPage(page + 1)}
                >
                  {t('home.catalog.next')}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  )
}
