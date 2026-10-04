import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, X } from 'lucide-react'
import { api, enqueueContract, pollContractJob, type EnterpriseOption, type Template } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  template: Template | null
  onClose: () => void
  onGenerated: () => void
}

// Normaliza um nome de variável para casar com campos de empresa (sem acento, minúsculo).
const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

// Deriva o valor de uma variável a partir de uma empresa, quando o nome casa.
function fromEnterprise(variable: string, e: EnterpriseOption): string | null {
  const addr = [e.street, e.number].filter(Boolean).join(', ')
  const full = [addr, e.neighborhood, [e.city, e.state].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' - ')
  const map: Record<string, string | null> = {
    nome: e.name,
    razaosocial: e.name,
    razao: e.name,
    empresa: e.name,
    cnpj: e.cnpj,
    cidade: e.city,
    municipio: e.city,
    estado: e.state,
    uf: e.state,
    bairro: e.neighborhood,
    rua: e.street,
    logradouro: e.street,
    numero: e.number,
    cep: e.zip_code,
    endereco: full || null,
    telefone: e.phone_number,
    fone: e.phone_number,
    responsavel: e.responsible_person,
    contato: e.responsible_person,
    email: e.contact_email,
  }
  return map[norm(variable)] ?? null
}

export function GenerateContractModal({ template, onClose, onGenerated }: Props) {
  const { t } = useTranslation()
  const open = template !== null
  const variables = useMemo(() => template?.variables ?? [], [template])

  const [values, setValues] = useState<Record<string, string>>({})
  const [outName, setOutName] = useState('')
  const [asPdf, setAsPdf] = useState(true)
  const [enterprises, setEnterprises] = useState<EnterpriseOption[]>([])
  const [enterpriseUuid, setEnterpriseUuid] = useState('')
  const [prefilled, setPrefilled] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (k: string, v: string) => setValues((s) => ({ ...s, [k]: v }))

  // Reseta ao (re)abrir com um template.
  useEffect(() => {
    if (!template) return
    setValues(Object.fromEntries(variables.map((v) => [v, ''])))
    setOutName(template.name.replace(/\.docx$/i, ''))
    setAsPdf(true)
    setEnterpriseUuid('')
    setPrefilled(false)
    setError(null)
  }, [template, variables])

  // Carrega TODAS as empresas (sem paginação) para o seletor.
  useEffect(() => {
    if (!open) return
    api<EnterpriseOption[]>('/enterprises/all', { auth: true })
      .then((list) => setEnterprises(list))
      .catch(() => setEnterprises([]))
  }, [open])

  // Fecha com Esc.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !template) return null

  function applyEnterprise(uuid: string) {
    const e = enterprises.find((x) => x.uuid === uuid)
    if (!e) return
    setValues((cur) => {
      const next = { ...cur }
      for (const v of variables) {
        const derived = fromEnterprise(v, e)
        if (derived) next[v] = derived
      }
      return next
    })
    setPrefilled(true)
  }

  async function onSubmit(ev: React.FormEvent) {
    ev.preventDefault()
    setError(null)
    if (!outName.trim()) {
      setError(t('templates.generate.missingName'))
      return
    }
    setSubmitting(true)
    try {
      // Geração é assíncrona: enfileira e acompanha o job até terminar.
      const job = await enqueueContract({
        templateUuid: template!.uuid,
        values,
        outName: outName.trim(),
        asPdf,
        enterpriseUuid: enterpriseUuid || undefined,
      })
      const done = await pollContractJob(job.uuid)
      if (done.status === 'failed') {
        if ((done.error || '').includes('missing_variables')) setError(t('templates.generate.missingVariables'))
        else setError(t('templates.generate.error'))
        return
      }
      toast.success(t('templates.generate.success'))
      onGenerated()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('missing_variables')) setError(t('templates.generate.missingVariables'))
      else setError(t('templates.generate.error'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-background shadow-xl">
        <div className="flex items-center gap-3 bg-primary px-5 py-4 text-primary-foreground">
          <button type="button" onClick={onClose} aria-label="voltar" className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{t('templates.generate.title')}</h2>
            <p className="truncate text-xs opacity-80">{t('templates.generate.fromTemplate', { name: template.name })}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="fechar" className="ml-auto shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
          {/* Empresa (opcional): pré-preenche as variáveis E vincula o contrato a ela */}
          {enterprises.length > 0 && (
            <div className="grid gap-1.5">
              <Label htmlFor="from-enterprise">{t('templates.generate.enterprise')}</Label>
              <select
                id="from-enterprise"
                value={enterpriseUuid}
                onChange={(e) => {
                  setEnterpriseUuid(e.target.value)
                  if (e.target.value) applyEnterprise(e.target.value)
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
              {prefilled && (
                <p className="text-xs text-green-700">{t('templates.generate.prefilled')}</p>
              )}
            </div>
          )}

          {/* Campos por variável */}
          {variables.length === 0 ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t('templates.generate.noVariables')}
            </p>
          ) : (
            <div className="grid gap-3">
              {variables.map((v) => (
                <div key={v} className="grid gap-1.5">
                  <Label htmlFor={`var-${v}`} className="font-mono text-xs">{`{{${v}}}`}</Label>
                  <Input id={`var-${v}`} value={values[v] ?? ''} onChange={(e) => set(v, e.target.value)} />
                </div>
              ))}
            </div>
          )}

          {/* Nome do arquivo */}
          <div className="grid gap-1.5">
            <Label htmlFor="out-name">{t('templates.generate.outName')}</Label>
            <Input id="out-name" value={outName} onChange={(e) => setOutName(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('templates.generate.outNameHint')}</p>
          </div>

          {/* PDF */}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={asPdf} onChange={(e) => setAsPdf(e.target.checked)} />
            {t('templates.generate.asPdf')}
          </label>

          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? t('templates.generate.submitting') : t('templates.generate.submit')}
          </Button>
        </form>
      </div>
    </div>
  )
}
