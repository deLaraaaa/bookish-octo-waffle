import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Download, FileText, FolderSync, Loader2, RefreshCw, UploadCloud } from 'lucide-react'
import {
  api,
  apiForm,
  downloadFile,
  type GeneratedContract,
  type Template,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { GenerateContractModal } from '@/components/generate-contract-modal'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const DOC_STATUSES = ['draft', 'pending', 'signed', 'refused', 'expired', 'archived'] as const

export function TemplatesContracts() {
  const { t, i18n } = useTranslation()

  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templatesError, setTemplatesError] = useState(false)

  const [contracts, setContracts] = useState<GeneratedContract[]>([])
  const [contractsLoading, setContractsLoading] = useState(true)
  const [contractsError, setContractsError] = useState(false)

  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [generateFor, setGenerateFor] = useState<Template | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function loadTemplates() {
    setTemplatesLoading(true)
    setTemplatesError(false)
    try {
      const data = await api<{ templates: Template[] }>('/storage/templates', { auth: true })
      setTemplates(data.templates)
    } catch {
      setTemplatesError(true)
    } finally {
      setTemplatesLoading(false)
    }
  }

  async function loadContracts() {
    setContractsLoading(true)
    setContractsError(false)
    try {
      const data = await api<{ contracts: GeneratedContract[] }>('/storage/contracts', { auth: true })
      setContracts(data.contracts)
    } catch {
      setContractsError(true)
    } finally {
      setContractsLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
    loadContracts()
  }, [])

  async function onImport(file: File) {
    setImporting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await apiForm('/storage/templates', fd)
      toast.success(t('templates.templates.importSuccess'))
      await loadTemplates()
    } catch {
      toast.error(t('templates.templates.importError'))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onSync() {
    setSyncing(true)
    try {
      const r = await api<{ added: string[]; removed: string[]; skipped: string[] }>(
        '/storage/templates/sync',
        { method: 'POST', auth: true }
      )
      toast.success(t('templates.templates.syncDone', { added: r.added.length, removed: r.removed.length }))
      await loadTemplates()
    } catch {
      toast.error(t('templates.templates.syncError'))
    } finally {
      setSyncing(false)
    }
  }

  async function onStatusChange(c: GeneratedContract, status: string) {
    try {
      await api('/storage/contracts/status', {
        method: 'PATCH',
        auth: true,
        body: { itemId: c.id, name: c.name, status },
      })
      setContracts((cur) => cur.map((x) => (x.id === c.id ? { ...x, status } : x)))
      toast.success(t('templates.contracts.statusUpdated'))
    } catch {
      toast.error(t('templates.contracts.statusError'))
    }
  }

  async function onDownload(c: GeneratedContract) {
    setDownloading(c.id)
    try {
      await downloadFile(`/storage/download/${c.id}?name=${encodeURIComponent(c.name)}`, c.name)
    } catch {
      toast.error(t('templates.contracts.loadError'))
    } finally {
      setDownloading(null)
    }
  }

  const dateFmt = (s?: string) => (s ? new Date(s).toLocaleDateString(i18n.language) : '')

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">{t('templates.sectionTitle')}</h2>
        <p className="text-sm text-muted-foreground">{t('templates.sectionDescription')}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------- Modelos ---------- */}
        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">{t('templates.templates.title')}</h3>
              <p className="text-xs text-muted-foreground">{t('templates.templates.description')}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" disabled={syncing} onClick={onSync} title={t('templates.templates.syncHint')}>
                {syncing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FolderSync className="mr-1 h-4 w-4" />}
                {t('templates.templates.sync')}
              </Button>
              <Button size="sm" disabled={importing} onClick={() => fileRef.current?.click()}>
                {importing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-1 h-4 w-4" />}
                {importing ? t('templates.templates.importing') : t('templates.templates.import')}
              </Button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".docx"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onImport(f)
              }}
            />
          </div>

          {templatesLoading ? (
            <p className="text-sm text-muted-foreground">{t('manage.loading')}</p>
          ) : templatesError ? (
            <p className="text-sm text-destructive">{t('templates.templates.loadError')}</p>
          ) : templates.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('templates.templates.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((tpl) => (
                <li
                  key={tpl.uuid}
                  className="flex items-center gap-3 rounded-md border p-3"
                >
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{tpl.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('templates.templates.variableCount', { count: tpl.variables?.length ?? 0 })}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setGenerateFor(tpl)}>
                    {t('templates.templates.generate')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------- Contratos gerados ---------- */}
        <div className="rounded-lg border bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="font-medium">{t('templates.contracts.title')}</h3>
              <p className="text-xs text-muted-foreground">{t('templates.contracts.description')}</p>
            </div>
            <Button size="sm" variant="outline" disabled={contractsLoading} onClick={loadContracts}>
              <RefreshCw className={`mr-1 h-4 w-4 ${contractsLoading ? 'animate-spin' : ''}`} />
              {t('templates.contracts.refresh')}
            </Button>
          </div>

          {contractsLoading ? (
            <p className="text-sm text-muted-foreground">{t('manage.loading')}</p>
          ) : contractsError ? (
            <p className="text-sm text-destructive">{t('templates.contracts.loadError')}</p>
          ) : contracts.length === 0 ? (
            <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {t('templates.contracts.empty')}
            </p>
          ) : (
            <ul className="space-y-2">
              {contracts.map((c) => (
                <li key={c.id} className="flex items-center gap-2 rounded-md border p-3">
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(c.size)} · {dateFmt(c.modified)}
                    </p>
                  </div>
                  <select
                    value={c.status ?? 'draft'}
                    onChange={(e) => onStatusChange(c, e.target.value)}
                    className="h-8 shrink-0 rounded-md border border-input bg-background px-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    title={t('templates.contracts.status')}
                  >
                    {DOC_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`home.docStatus.${s}`)}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={downloading === c.id}
                    onClick={() => onDownload(c)}
                  >
                    {downloading === c.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <GenerateContractModal
        template={generateFor}
        onClose={() => setGenerateFor(null)}
        onGenerated={loadContracts}
      />
    </section>
  )
}
