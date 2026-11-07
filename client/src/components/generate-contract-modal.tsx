import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, X } from 'lucide-react'
import { api, enqueueContract, pollContractJob, type EnterpriseOption, type Template } from '@/lib/api'
import { errorMessage } from '@/lib/errors'
import { humanizeVariable, normalizeVariable, valueFromEnterprise } from '@/lib/variables'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  template: Template | null
  onClose: () => void
  onGenerated: () => void
}

const MESES_PADRAO = 12

function defaultDueDate(): string {
  const d = new Date()
  d.setMonth(d.getMonth() + MESES_PADRAO)
  return d.toISOString().slice(0, 10)
}

export function GenerateContractModal({ template, onClose, onGenerated }: Props) {
  const { t } = useTranslation()
  const open = template !== null
  const variables = useMemo(() => template?.variables ?? [], [template])

  const [values, setValues] = useState<Record<string, string>>({})
  const [fromRegistry, setFromRegistry] = useState<string[]>([])
  const [outName, setOutName] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [asPdf, setAsPdf] = useState(true)
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([])
  const [enterpriseUuid, setEnterpriseUuid] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const labelFor = (v: string) =>
    t(`templates.vars.${normalizeVariable(v)}`, { defaultValue: humanizeVariable(v) })

  function set(k: string, v: string) {
    setValues((s) => ({ ...s, [k]: v }))
    setFromRegistry((cur) => cur.filter((name) => name !== k))
  }

  useEffect(() => {
    if (!template) return
    setValues(Object.fromEntries(variables.map((v) => [v, ''])))
    setFromRegistry([])
    setOutName(template.name.replace(/\.docx$/i, ''))
    setDueDate(defaultDueDate())
    setAsPdf(true)
    setEnterpriseUuid('')
    setError(null)
  }, [template, variables])

  useEffect(() => {
    if (!open) return
    api<EnterpriseOption[]>('/enterprises/all', { auth: true })
      .then((list) => setEnterprises(list))
      .catch(() => setEnterprises([]))
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !template) return null

  function applyEnterprise(uuid: string) {
    const e = enterprises.find((x) => x.uuid === uuid)
    if (!e) {
      setFromRegistry([])
      return
    }
    const derived: string[] = []
    setValues((cur) => {
      const next = { ...cur }
      for (const v of variables) {
        const value = valueFromEnterprise(v, e)
        if (value) {
          next[v] = value
          derived.push(v)
        }
      }
      return next
    })
    setFromRegistry(derived)
  }

  const missing = variables.filter((v) => !(values[v] ?? '').trim())

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (!outName.trim()) {
      setError(t('templates.generate.missingName'))
      return
    }
    setSubmitting(true)
    try {
      const job = await enqueueContract({
        templateUuid: template!.uuid,
        values,
        outName: outName.trim(),
        asPdf,
        enterpriseUuid: enterpriseUuid || undefined,
        dueDate: dueDate || undefined,
      })
      const done = await pollContractJob(job.uuid)
      if (done.status === 'failed') {
        setError(errorMessage(t, new Error(done.error || ''), 'templates.generate.error'))
        return
      }
      toast.success(t('templates.generate.success'))
      onGenerated()
      onClose()
    } catch (err) {
      setError(errorMessage(t, err, 'templates.generate.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-contract-title"
        className="w-full max-w-lg overflow-hidden rounded-xl bg-background shadow-xl"
      >
        <div className="flex items-center gap-3 bg-primary px-5 py-4 text-primary-foreground">
          <button type="button" onClick={onClose} aria-label={t('common.back')} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 id="generate-contract-title" className="text-lg font-semibold">
              {t('templates.generate.title')}
            </h2>
            <p className="truncate text-xs opacity-80">
              {t('templates.generate.fromTemplate', { name: template.name })}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="ml-auto shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
          {enterprises.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="from-enterprise">{t('templates.generate.enterprise')}</Label>
              <select
                id="from-enterprise"
                value={enterpriseUuid}
                onChange={(e) => {
                  setEnterpriseUuid(e.target.value)
                  applyEnterprise(e.target.value)
                }}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">{t('templates.generate.selectEnterprise')}</option>
                {enterprises.map((e) => (
                  <option key={e.uuid} value={e.uuid}>
                    {e.name}
                  </option>
                ))}
              </select>
              {enterpriseUuid ? (
                <p className="text-xs text-green-700">{t('templates.generate.willLink')}</p>
              ) : (
                <p className="text-xs text-muted-foreground">{t('templates.generate.enterpriseHint')}</p>
              )}
            </div>
          )}

          {variables.length === 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('templates.generate.noVariables')}
            </p>
          ) : (
            <div className="grid gap-3">
              {variables.map((v) => {
                const filled = fromRegistry.includes(v)
                return (
                  <div key={v} className="grid gap-1.5">
                    <Label htmlFor={`var-${v}`}>{labelFor(v)}</Label>
                    <Input
                      id={`var-${v}`}
                      value={values[v] ?? ''}
                      aria-describedby={filled ? `var-${v}-origin` : undefined}
                      onChange={(e) => set(v, e.target.value)}
                    />
                    {filled && (
                      <p
                        id={`var-${v}-origin`}
                        className="flex items-center gap-1 text-xs text-green-700"
                      >
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        {t('templates.generate.fromRegistry')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {variables.length > 0 && (
            <div className="rounded-md border bg-muted/40 px-3 py-2">
              <p className="text-xs font-semibold">{t('templates.generate.reviewTitle')}</p>
              <dl className="mt-1.5 grid gap-1 text-xs">
                {variables.map((v) => {
                  const value = (values[v] ?? '').trim()
                  return (
                    <div key={v} className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">{labelFor(v)}:</dt>
                      <dd className={value ? 'min-w-0 break-words' : 'text-destructive'}>
                        {value || t('templates.generate.emptyValue')}
                      </dd>
                    </div>
                  )
                })}
              </dl>
              {missing.length > 0 && (
                <p className="mt-2 text-xs text-destructive">
                  {t('templates.generate.missingCount', { count: missing.length })}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="out-name">{t('templates.generate.outName')}</Label>
            <Input id="out-name" value={outName} onChange={(e) => setOutName(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('templates.generate.outNameHint')}</p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="due-date">{t('templates.generate.dueDate')}</Label>
            <Input
              id="due-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('templates.generate.dueDateHint')}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={asPdf} onChange={(e) => setAsPdf(e.target.checked)} />
            {t('templates.generate.asPdf')}
          </label>

          {error && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? t('templates.generate.submitting') : t('templates.generate.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
