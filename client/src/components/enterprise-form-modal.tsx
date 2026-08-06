import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, CheckCircle2, Loader2, Search, UploadCloud, X } from 'lucide-react'
import { api, apiForm, type CnpjLookup } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

const EMPTY = {
  cnpj: '',
  name: '',
  contactName: '',
  contactEmail: '',
  street: '',
  number: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
  phoneNumber: '',
}

type CnpjState = 'idle' | 'looking' | 'ok' | 'error' | 'notfound' | 'invalid' | 'duplicate'

// 00.000.000/0000-00
function formatCnpj(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function EnterpriseFormModal({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ ...EMPTY })
  const [file, setFile] = useState<File | null>(null)
  const [cnpjState, setCnpjState] = useState<CnpjState>('idle')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // Reseta ao abrir/fechar.
  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY })
      setFile(null)
      setCnpjState('idle')
      setFormError(null)
    }
  }, [open])

  // Fecha com Esc.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  async function lookup(cnpjMasked: string) {
    const digits = cnpjMasked.replace(/\D/g, '')
    if (!digits) return
    // Não validamos os dígitos no cliente: o backend valida e responde 400
    // (invalid_cnpj) — usamos essa resposta para exibir o erro.
    setCnpjState('looking')
    try {
      const d = await api<CnpjLookup>(`/enterprises/cnpj/${digits}`, { auth: true })
      setForm((f) => ({
        ...f,
        name: d.razao_social || f.name,
        street: d.street || '',
        number: d.number || '',
        neighborhood: d.neighborhood || '',
        city: d.city || '',
        state: d.state || '',
        zipCode: d.zip_code || '',
        phoneNumber: d.phone_number || '',
      }))
      // Existe na Receita, mas já cadastrado no sistema? Avisa inline.
      setCnpjState(d.already_registered ? 'duplicate' : 'ok')
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('not_found')) setCnpjState('notfound')
      else if (msg.includes('invalid_cnpj')) setCnpjState('invalid')
      else setCnpjState('error')
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.name.trim()) {
      setFormError(t('home.form.nameRequired'))
      return
    }
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('name', form.name.trim())
      fd.append('cnpj', form.cnpj)
      fd.append('contact_name', form.contactName)
      fd.append('contact_email', form.contactEmail)
      fd.append('phone_number', form.phoneNumber)
      fd.append('street', form.street)
      fd.append('number', form.number)
      fd.append('neighborhood', form.neighborhood)
      fd.append('city', form.city)
      fd.append('state', form.state)
      fd.append('zip_code', form.zipCode)
      if (file) fd.append('document', file)
      await apiForm('/enterprises', fd)
      toast.success(t('home.form.success'))
      onCreated()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('cnpj_already_exists')) setCnpjState('duplicate')
      else if (msg.includes('invalid_cnpj')) setCnpjState('invalid')
      else setFormError(t('home.form.error'))
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
        {/* Header */}
        <div className="flex items-center gap-3 bg-primary px-5 py-4 text-primary-foreground">
          <button type="button" onClick={onClose} aria-label="voltar" className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 className="text-lg font-semibold">{t('home.form.title')}</h2>
          <button type="button" onClick={onClose} aria-label="fechar" className="ml-auto shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
          {/* CNPJ */}
          <div className="grid gap-1.5">
            <Label htmlFor="cnpj">{t('home.form.cnpj')}</Label>
            <div className="flex gap-2">
              <Input
                id="cnpj"
                inputMode="numeric"
                placeholder="00.000.000/0000-00"
                value={form.cnpj}
                onChange={(e) => set('cnpj', formatCnpj(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    lookup(form.cnpj)
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => lookup(form.cnpj)}
                disabled={cnpjState === 'looking' || !form.cnpj.trim()}
              >
                {cnpjState === 'looking' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-1 h-4 w-4" />
                )}
                {t('home.form.cnpjLookup')}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('home.form.cnpjHint')}</p>
            {cnpjState === 'looking' && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('home.form.cnpjLooking')}
              </p>
            )}
            {cnpjState === 'notfound' && (
              <p className="text-xs text-destructive">{t('home.form.cnpjNotFound')}</p>
            )}
            {cnpjState === 'invalid' && (
              <p className="text-xs text-destructive">{t('home.form.cnpjInvalid')}</p>
            )}
            {cnpjState === 'duplicate' && (
              <p className="text-xs text-destructive">{t('home.form.cnpjDuplicate')}</p>
            )}
            {cnpjState === 'error' && (
              <p className="text-xs text-destructive">{t('home.form.cnpjError')}</p>
            )}
          </div>

          {/* Razão social */}
          <div className="grid gap-1.5">
            <Label htmlFor="name">{t('home.form.razao')}</Label>
            <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} />
            {cnpjState === 'ok' && (
              <p className="flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 className="h-3 w-3" /> {t('home.form.autofilled')}
              </p>
            )}
          </div>

          {/* Contato */}
          <div className="grid gap-1.5">
            <Label>{t('home.form.contact')}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                placeholder={t('home.form.contactName')}
                value={form.contactName}
                onChange={(e) => set('contactName', e.target.value)}
              />
              <Input
                type="email"
                placeholder={t('home.form.contactEmail')}
                value={form.contactEmail}
                onChange={(e) => set('contactEmail', e.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">{t('home.form.contactHint')}</p>
          </div>

          {/* Endereço */}
          <div className="grid gap-1.5">
            <Label>{t('home.form.address')}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
              <Input
                className="sm:col-span-4"
                placeholder={t('home.form.street')}
                value={form.street}
                onChange={(e) => set('street', e.target.value)}
              />
              <Input
                className="sm:col-span-2"
                placeholder={t('home.form.number')}
                value={form.number}
                onChange={(e) => set('number', e.target.value)}
              />
              <Input
                className="sm:col-span-3"
                placeholder={t('home.form.neighborhood')}
                value={form.neighborhood}
                onChange={(e) => set('neighborhood', e.target.value)}
              />
              <Input
                className="sm:col-span-3"
                placeholder={t('home.form.city')}
                value={form.city}
                onChange={(e) => set('city', e.target.value)}
              />
              <Input
                className="sm:col-span-2"
                placeholder={t('home.form.state')}
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
              />
              <Input
                className="sm:col-span-4"
                placeholder={t('home.form.zip')}
                value={form.zipCode}
                onChange={(e) => set('zipCode', e.target.value)}
              />
            </div>
          </div>

          {/* Documento (opcional) */}
          <div className="grid gap-1.5">
            <Label htmlFor="document">{t('home.form.document')}</Label>
            <label
              htmlFor="document"
              className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground transition-colors hover:bg-muted/50"
            >
              <UploadCloud className="h-4 w-4" />
              {file ? file.name : t('home.form.dropzone')}
            </label>
            <input
              id="document"
              type="file"
              accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {formError && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {formError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? t('home.form.submitting') : t('home.form.submit')}
          </Button>
          <p className="text-xs text-muted-foreground">{t('home.form.footer')}</p>
        </form>
      </div>
    </div>
  )
}
