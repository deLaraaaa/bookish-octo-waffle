import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, Search, UploadCloud, X } from 'lucide-react'
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

export function formatCnpj(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 14)
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function formatZip(value: string): string {
  const d = value.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

const CNPJ_ERRORS: CnpjState[] = ['notfound', 'invalid', 'duplicate', 'error']

export function EnterpriseFormModal({ open, onClose, onCreated }: Props) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ ...EMPTY })
  const [file, setFile] = useState<File | null>(null)
  const [cnpjState, setCnpjState] = useState<CnpjState>('idle')
  const [duplicateName, setDuplicateName] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [nameError, setNameError] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const cnpjRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const lastLookup = useRef('')

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }))

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY })
      setFile(null)
      setCnpjState('idle')
      setDuplicateName(null)
      setFormError(null)
      setNameError(false)
      lastLookup.current = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function focusCnpj() {
    cnpjRef.current?.focus()
    cnpjRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  async function lookup(cnpjMasked: string) {
    const digits = cnpjMasked.replace(/\D/g, '')
    if (!digits) return
    lastLookup.current = digits
    setCnpjState('looking')
    setDuplicateName(null)
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
        zipCode: formatZip(d.zip_code || ''),
        phoneNumber: d.phone_number || '',
      }))
      setNameError(false)
      if (d.already_registered) {
        setDuplicateName(d.razao_social)
        setCnpjState('duplicate')
      } else {
        setCnpjState('ok')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('not_found')) setCnpjState('notfound')
      else if (msg.includes('invalid_cnpj')) setCnpjState('invalid')
      else setCnpjState('error')
    }
  }

  function onCnpjChange(raw: string) {
    const masked = formatCnpj(raw)
    set('cnpj', masked)
    const digits = masked.replace(/\D/g, '')
    if (digits.length < 14) {
      lastLookup.current = ''
      if (CNPJ_ERRORS.includes(cnpjState)) setCnpjState('idle')
      return
    }
    if (lastLookup.current !== digits) lookup(masked)
  }

  function onCnpjBlur() {
    const digits = form.cnpj.replace(/\D/g, '')
    if (digits.length === 14 && lastLookup.current !== digits) lookup(form.cnpj)
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    if (!form.name.trim()) {
      setNameError(true)
      nameRef.current?.focus()
      nameRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      return
    }
    setNameError(false)
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('name', form.name.trim())
      fd.append('cnpj', form.cnpj)
      fd.append('contact_name', form.contactName.trim())
      fd.append('contact_email', form.contactEmail.trim())
      fd.append('phone_number', form.phoneNumber)
      fd.append('street', form.street.trim())
      fd.append('number', form.number.trim())
      fd.append('neighborhood', form.neighborhood.trim())
      fd.append('city', form.city.trim())
      fd.append('state', form.state.trim().toUpperCase())
      fd.append('zip_code', form.zipCode.replace(/\D/g, ''))
      if (file) fd.append('document', file)
      await apiForm('/enterprises', fd)
      toast.success(t('home.form.success'))
      onCreated()
      onClose()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('cnpj_already_exists')) {
        setCnpjState('duplicate')
        focusCnpj()
      } else if (msg.includes('invalid_cnpj')) {
        setCnpjState('invalid')
        focusCnpj()
      } else {
        setFormError(t('home.form.error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  const cnpjMessage =
    cnpjState === 'notfound'
      ? t('home.form.cnpjNotFound')
      : cnpjState === 'invalid'
      ? t('home.form.cnpjInvalid')
      : cnpjState === 'duplicate'
      ? duplicateName
        ? t('home.form.cnpjDuplicateNamed', { name: duplicateName })
        : t('home.form.cnpjDuplicate')
      : cnpjState === 'error'
      ? t('home.form.cnpjError')
      : null

  const required = <span aria-hidden="true" className="ml-0.5 text-primary">*</span>

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="enterprise-form-title"
        className="w-full max-w-lg overflow-hidden rounded-xl bg-background shadow-xl"
      >
        <div className="flex items-center gap-3 bg-primary px-5 py-4 text-primary-foreground">
          <button type="button" onClick={onClose} aria-label={t('common.back')} className="shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 id="enterprise-form-title" className="text-lg font-semibold">
            {t('home.form.title')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="ml-auto shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} noValidate className="space-y-4 px-5 py-5">
          <p className="text-xs text-muted-foreground">{t('home.form.requiredLegend')}</p>

          <div className="grid gap-1.5">
            <Label htmlFor="cnpj">{t('home.form.cnpj')}</Label>
            <div className="flex gap-2">
              <Input
                id="cnpj"
                ref={cnpjRef}
                inputMode="numeric"
                autoComplete="off"
                placeholder="00.000.000/0000-00"
                aria-describedby="cnpj-hint"
                aria-invalid={CNPJ_ERRORS.includes(cnpjState)}
                value={form.cnpj}
                onChange={(e) => onCnpjChange(e.target.value)}
                onBlur={onCnpjBlur}
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
            <p id="cnpj-hint" className="text-xs text-muted-foreground">
              {t('home.form.cnpjHint')}
            </p>
            {cnpjState === 'looking' && (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {t('home.form.cnpjLooking')}
              </p>
            )}
            {cnpjMessage && (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="flex items-center gap-1 text-xs text-destructive">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {cnpjMessage}
                </p>
                <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={focusCnpj}>
                  {t('home.form.fixCnpj')}
                </Button>
              </div>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="name">
              {t('home.form.razao')}
              {required}
            </Label>
            <Input
              id="name"
              ref={nameRef}
              value={form.name}
              aria-required="true"
              aria-invalid={nameError}
              onChange={(e) => {
                set('name', e.target.value)
                if (nameError) setNameError(false)
              }}
            />
            {nameError && (
              <p role="alert" className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {t('home.form.nameRequired')}
              </p>
            )}
            {cnpjState === 'ok' && !nameError && (
              <p className="flex items-center gap-1 text-xs text-green-700">
                <CheckCircle2 className="h-3 w-3" /> {t('home.form.autofilled')}
              </p>
            )}
          </div>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{t('home.form.contact')}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="contactName">{t('home.form.contactName')}</Label>
                <Input
                  id="contactName"
                  autoComplete="name"
                  value={form.contactName}
                  onChange={(e) => set('contactName', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="contactEmail">{t('home.form.contactEmail')}</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  autoComplete="email"
                  value={form.contactEmail}
                  onChange={(e) => set('contactEmail', e.target.value)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{t('home.form.contactHint')}</p>
          </fieldset>

          <fieldset className="grid gap-1.5">
            <legend className="mb-1.5 text-sm font-medium">{t('home.form.address')}</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-6">
              <div className="grid gap-1.5 sm:col-span-4">
                <Label htmlFor="street">{t('home.form.street')}</Label>
                <Input
                  id="street"
                  autoComplete="address-line1"
                  value={form.street}
                  onChange={(e) => set('street', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="number">{t('home.form.number')}</Label>
                <Input id="number" value={form.number} onChange={(e) => set('number', e.target.value)} />
              </div>
              <div className="grid gap-1.5 sm:col-span-3">
                <Label htmlFor="neighborhood">{t('home.form.neighborhood')}</Label>
                <Input
                  id="neighborhood"
                  value={form.neighborhood}
                  onChange={(e) => set('neighborhood', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-3">
                <Label htmlFor="city">{t('home.form.city')}</Label>
                <Input
                  id="city"
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="state">{t('home.form.state')}</Label>
                <Input
                  id="state"
                  maxLength={2}
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={(e) => set('state', e.target.value.toUpperCase())}
                />
              </div>
              <div className="grid gap-1.5 sm:col-span-4">
                <Label htmlFor="zipCode">{t('home.form.zip')}</Label>
                <Input
                  id="zipCode"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  placeholder="00000-000"
                  value={form.zipCode}
                  onChange={(e) => set('zipCode', formatZip(e.target.value))}
                />
              </div>
            </div>
          </fieldset>

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
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
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
