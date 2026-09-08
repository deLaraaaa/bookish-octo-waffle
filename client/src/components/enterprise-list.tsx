import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText, MapPin, Phone, User } from 'lucide-react'
import type { Contract, Enterprise, EnterpriseCard } from '@/lib/api'
import { cn } from '@/lib/utils'

// Cor do selo por status da empresa: verde=ativa, âmbar=pendente,
// vermelho=suspensa, cinza=inativa.
export function statusBadgeClasses(status: string): string {
  switch (status) {
    case 'active':
      return 'bg-green-100 text-green-800'
    case 'pending':
      return 'bg-amber-100 text-amber-800'
    case 'suspended':
      return 'bg-red-100 text-red-800'
    case 'inactive':
    default:
      return 'bg-slate-100 text-slate-700'
  }
}

export function formatAddress(e: {
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

// Linha compacta do catálogo público (sem contratos).
export function EnterpriseRow({
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

// Linha completa (empresa + contratos). Usada em "Minhas empresas" e na gestão.
// `statusLabel`: rótulo do estado exibido no cabeçalho (opcional).
// `actions`: ação(ões) renderizada(s) no corpo expandido (ex.: botão Aprovar).
export function MyEnterpriseRow({
  enterprise: e,
  open,
  onToggle,
  statusLabel,
  actions,
  contractControls,
}: {
  enterprise: EnterpriseCard
  open: boolean
  onToggle: () => void
  statusLabel?: string
  actions?: ReactNode
  // Controles por contrato (ver/baixar/status) — usados só na gestão.
  contractControls?: (contract: Contract) => ReactNode
}) {
  const { t } = useTranslation()
  const na = t('home.catalog.notProvided')
  const address = formatAddress(e)
  const contracts = e.contracts ?? []
  const badge = statusLabel ?? t(`enterpriseStatus.${e.status}`, { defaultValue: e.status })

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
          {badge && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs font-medium',
                statusBadgeClasses(e.status)
              )}
            >
              {badge}
            </span>
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">
            {t('home.mine.contractCount', { count: contracts.length })}
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
            {contracts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('home.mine.noContracts')}</p>
            ) : (
              <ul className="space-y-2">
                {contracts.map((c) => (
                  <ContractItem key={c.uuid} contract={c} controls={contractControls?.(c)} />
                ))}
              </ul>
            )}
          </div>

          {actions && <div className="flex flex-wrap gap-2 pt-1">{actions}</div>}
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

export function ContractItem({
  contract: c,
  controls,
}: {
  contract: Contract
  controls?: ReactNode
}) {
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
      {/* Gestão passa controles (ver/baixar/status); demais telas mostram só o selo. */}
      {controls ?? (
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
            docStatusClasses(c.status)
          )}
        >
          {t(`home.docStatus.${c.status}`, { defaultValue: c.status })}
        </span>
      )}
    </li>
  )
}

export function Detail({
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
