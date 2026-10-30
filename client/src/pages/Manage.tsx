import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Download, Eye, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  api,
  downloadFile,
  viewFile,
  type Contract,
  type Institution,
  type MyEnterprise,
  type Paginated,
  exportManage,
  fetchLifecycle,
  type LifecycleMachines,
} from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { errorMessage } from '@/lib/errors'
import { daysSince, waitTone, waitToneClasses } from '@/lib/time'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ExportButton } from '@/components/export-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LanguageSwitcher } from '@/components/language-switcher'
import { MyEnterpriseRow } from '@/components/enterprise-list'
import { TemplatesContracts } from '@/components/templates-contracts'
import { LinkContractModal } from '@/components/link-contract-modal'
import { Logo } from '@/style'


type EnterpriseStatus = 'pending' | 'active' | 'suspended' | 'inactive'
const STATUS_OPTIONS: EnterpriseStatus[] = ['pending', 'active', 'suspended', 'inactive']
const REASON_MIN_LENGTH = 5

type PendingAction =
  | { kind: 'reject'; uuid: string; name: string }
  | { kind: 'suspend'; uuid: string; name: string }
  | { kind: 'bulkApprove'; uuids: string[] }

export default function Manage() {
  const { t } = useTranslation()
  const { account, logout } = useAuth()

  const [tab, setTab] = useState<'enterprises' | 'templates'>('enterprises')
  const [linkFor, setLinkFor] = useState<{ uuid: string; name: string } | null>(null)
  const [cities, setCities] = useState<string[]>([])
  const [openUuid, setOpenUuid] = useState<string | null>(null)
  const [busyUuid, setBusyUuid] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [confirming, setConfirming] = useState<PendingAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [transicoes, setTransicoes] = useState<LifecycleMachines['document'] | null>(null)

  const [all, setAll] = useState<MyEnterprise[]>([])
  const [allLoading, setAllLoading] = useState(true)
  const [allError, setAllError] = useState(false)
  const [allSearchInput, setAllSearchInput] = useState('')
  const [allSearch, setAllSearch] = useState('')
  const [allCity, setAllCity] = useState('')
  const [allStatus, setAllStatus] = useState('')
  const [allPage, setAllPage] = useState(1)
  const [allHasMore, setAllHasMore] = useState(false)

  const [pending, setPending] = useState<MyEnterprise[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingError, setPendingError] = useState(false)
  const [pendingSearchInput, setPendingSearchInput] = useState('')
  const [pendingSearch, setPendingSearch] = useState('')
  const [pendingPage, setPendingPage] = useState(1)
  const [pendingHasMore, setPendingHasMore] = useState(false)

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
      setSelected((cur) => cur.filter((uuid) => data.items.some((e) => e.uuid === uuid)))
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
      }
    }
    loadCities()
    fetchLifecycle()
      .then((m) => setTransicoes(m.document ?? null))
      .catch(() => setTransicoes(null))
    fetchAll('', 1, '', '')
    fetchPending('', 1)
  }, [])

  const firstTabRender = useRef(true)
  useEffect(() => {
    if (firstTabRender.current) {
      firstTabRender.current = false
      return
    }
    if (tab === 'enterprises') {
      fetchAll(allSearch, allPage, allCity, allStatus)
      fetchPending(pendingSearch, pendingPage)
    }
  }, [tab])

  async function updateContractStatus(documentUuid: string, status: string) {
    try {
      await api(`/storage/contracts/${documentUuid}/status`, { method: 'PATCH', body: { status }, auth: true })
      toast.success(t('manage.contract.statusUpdated'))
      fetchAll(allSearch, allPage, allCity, allStatus)
      fetchPending(pendingSearch, pendingPage)
    } catch {
      toast.error(t('manage.contract.statusError'))
    }
  }

  function statusOptionsFor(atual: string): readonly string[] {
    if (!transicoes) return [atual]
    const destinos = transicoes[atual] ?? []
    return [atual, ...destinos]
  }

  function contractControls(c: Contract) {
    const proxy = c.item_id
      ? `/storage/download/${c.item_id}?name=${encodeURIComponent(c.name)}`
      : null
    return (
      <div className="flex shrink-0 items-center gap-1">
        {proxy && (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('manage.contract.view')}
              onClick={() => viewFile(proxy).catch(() => toast.error(t('manage.contract.viewError')))}
            >
              <Eye className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0"
              title={t('manage.contract.download')}
              onClick={() => downloadFile(proxy, c.name).catch(() => toast.error(t('manage.contract.downloadError')))}
            >
              <Download className="h-4 w-4" />
            </Button>
          </>
        )}
        <select
          value={c.status}
          onChange={(e) => updateContractStatus(c.uuid, e.target.value)}
          className="h-7 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {statusOptionsFor(c.status).map((s) => (
            <option key={s} value={s}>
              {t(`home.docStatus.${s}`)}
            </option>
          ))}
        </select>
      </div>
    )
  }

  async function reload() {
    await Promise.all([
      fetchAll(allSearch, allPage, allCity, allStatus),
      fetchPending(pendingSearch, pendingPage),
    ])
  }

  async function setStatus(uuid: string, status: EnterpriseStatus, reason?: string) {
    setBusyUuid(uuid)
    try {
      await api(`/enterprises/${uuid}/status`, {
        method: 'PATCH',
        body: reason ? { status, reason } : { status },
        auth: true,
      })
      await reload()
    } catch (err) {
      toast.error(errorMessage(t, err, 'manage.statusError'))
    } finally {
      setBusyUuid(null)
    }
  }

  async function runConfirmedAction(action: PendingAction, reason: string) {
    setConfirmBusy(true)
    try {
      if (action.kind === 'bulkApprove') {
        const results = await Promise.allSettled(
          action.uuids.map((uuid) =>
            api(`/enterprises/${uuid}/status`, { method: 'PATCH', body: { status: 'active' }, auth: true })
          )
        )
        const failed = results.filter((r) => r.status === 'rejected').length
        if (failed > 0) toast.error(t('manage.pending.bulkPartial', { count: failed }))
        else toast.success(t('manage.pending.bulkDone', { count: action.uuids.length }))
        setSelected([])
        await reload()
        return
      }
      const status: EnterpriseStatus = action.kind === 'reject' ? 'inactive' : 'suspended'
      await api(`/enterprises/${action.uuid}/status`, {
        method: 'PATCH',
        body: { status, reason },
        auth: true,
      })
      await reload()
    } catch (err) {
      toast.error(errorMessage(t, err, 'manage.statusError'))
    } finally {
      setConfirmBusy(false)
      setConfirming(null)
    }
  }

  function waitBadge(e: MyEnterprise) {
    const days = daysSince(e.insert_date)
    if (days === null) return null
    return (
      <span
        className={cn(
          'hidden rounded-full px-2 py-0.5 text-xs font-medium sm:inline',
          waitToneClasses(waitTone(days))
        )}
      >
        {days === 0 ? t('manage.pending.waitingToday') : t('manage.pending.waitingDays', { count: days })}
      </span>
    )
  }

  const toggleSelected = (uuid: string) =>
    setSelected((cur) => (cur.includes(uuid) ? cur.filter((u) => u !== uuid) : [...cur, uuid]))

  function actionsFor(e: MyEnterprise) {
    const status = e.status as EnterpriseStatus
    const busy = busyUuid === e.uuid
    const statusButtons =
      status === 'pending'
        ? [
            <Button key="approve" size="sm" disabled={busy} onClick={() => setStatus(e.uuid, 'active')}>
              {t('manage.actions.approve')}
            </Button>,
            <Button
              key="reject"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming({ kind: 'reject', uuid: e.uuid, name: e.name })}
            >
              {t('manage.actions.reject')}
            </Button>,
          ]
        : status === 'active'
        ? [
            <Button
              key="suspend"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirming({ kind: 'suspend', uuid: e.uuid, name: e.name })}
            >
              {t('manage.actions.suspend')}
            </Button>,
          ]
        : [
            <Button key="activate" size="sm" disabled={busy} onClick={() => setStatus(e.uuid, 'active')}>
              {t('manage.actions.activate')}
            </Button>,
          ]

    return [
      ...statusButtons,
      <Button
        key="link"
        size="sm"
        variant="outline"
        onClick={() => setLinkFor({ uuid: e.uuid, name: e.name })}
      >
        {t('manage.actions.linkContract')}
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

      <main className="container py-8">
        <div className="mb-6 flex gap-6 border-b">
          {(['enterprises', 'templates'] as const).map((key) => (
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
              {t(`manage.tabs.${key}`)}
            </button>
          ))}
        </div>

        {tab === 'enterprises' && (
        <div className="space-y-10">
        <section>
          <div className="mb-4">
            <h2 className="text-xl font-semibold">{t('manage.pending.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('manage.pending.description')}</p>
          </div>

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
              <div className="mb-2 flex flex-wrap items-center gap-3 px-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={selected.length === pending.length && pending.length > 0}
                    onChange={(ev) => setSelected(ev.target.checked ? pending.map((e) => e.uuid) : [])}
                  />
                  <span className="text-muted-foreground">{t('manage.pending.selectAll')}</span>
                </label>
                {selected.length > 0 && (
                  <>
                    <span className="text-sm text-muted-foreground">
                      {t('manage.pending.selectedCount', { count: selected.length })}
                    </span>
                    <Button
                      size="sm"
                      disabled={confirmBusy}
                      onClick={() => setConfirming({ kind: 'bulkApprove', uuids: selected })}
                    >
                      {t('manage.pending.approveSelected')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                      {t('manage.pending.clearSelection')}
                    </Button>
                  </>
                )}
              </div>
              <ul className="space-y-2">
                {pending.map((e) => (
                  <MyEnterpriseRow
                    key={e.uuid}
                    enterprise={e}
                    open={openUuid === e.uuid}
                    onToggle={() => toggle(e.uuid)}
                    actions={actionsFor(e)}
                    contractControls={contractControls}
                    meta={waitBadge(e)}
                    select={
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.includes(e.uuid)}
                        aria-label={t('manage.pending.selectOne', { name: e.name })}
                        onChange={() => toggleSelected(e.uuid)}
                      />
                    }
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

        <section>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold">{t('manage.all.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('manage.all.description')}</p>
            </div>
            <ExportButton
              onExport={() => exportManage({ search: allSearch, city: allCity, status: allStatus })}
              label={t('export.manage')}
              className="shrink-0"
            />
          </div>

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
                    contractControls={contractControls}
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
        </div>
        )}

        {tab === 'templates' && <TemplatesContracts />}
      </main>

      <LinkContractModal
        enterprise={linkFor}
        onClose={() => setLinkFor(null)}
        onLinked={() => {
          fetchAll(allSearch, allPage, allCity, allStatus)
          fetchPending(pendingSearch, pendingPage)
        }}
      />

      <ConfirmDialog
        open={confirming !== null}
        busy={confirmBusy}
        destructive={confirming?.kind !== 'bulkApprove'}
        title={
          confirming?.kind === 'bulkApprove'
            ? t('manage.confirm.bulkApproveTitle', { count: confirming.uuids.length })
            : confirming?.kind === 'suspend'
            ? t('manage.confirm.suspendTitle', { name: confirming.name })
            : t('manage.confirm.rejectTitle', { name: confirming?.name ?? '' })
        }
        description={
          confirming?.kind === 'bulkApprove'
            ? t('manage.confirm.bulkApproveDescription')
            : confirming?.kind === 'suspend'
            ? t('manage.confirm.suspendDescription')
            : t('manage.confirm.rejectDescription')
        }
        confirmLabel={
          confirming?.kind === 'bulkApprove'
            ? t('manage.pending.approveSelected')
            : confirming?.kind === 'suspend'
            ? t('manage.actions.suspend')
            : t('manage.actions.reject')
        }
        reason={
          confirming && confirming.kind !== 'bulkApprove'
            ? {
                label: t('manage.confirm.reasonLabel'),
                hint: t('manage.confirm.reasonHint'),
                placeholder: t('manage.confirm.reasonPlaceholder'),
                minLength: REASON_MIN_LENGTH,
                tooShort: t('manage.confirm.reasonTooShort'),
              }
            : undefined
        }
        onCancel={() => setConfirming(null)}
        onConfirm={(reason) => confirming && runConfirmedAction(confirming, reason)}
      />
    </div>
  )
}

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
