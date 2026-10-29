import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export type ReasonField = {
  label: string
  hint?: string
  placeholder?: string
  minLength?: number
  tooShort: string
}

type Props = {
  open: boolean
  title: string
  description?: string
  confirmLabel: string
  cancelLabel?: string
  destructive?: boolean
  busy?: boolean
  reason?: ReasonField
  onConfirm: (reason: string) => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  busy,
  reason,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const reasonRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) {
      setText('')
      setTouched(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  useEffect(() => {
    if (open && reason) reasonRef.current?.focus()
  }, [open, reason])

  if (!open) return null

  const min = reason?.minLength ?? 0
  const trimmed = text.trim()
  const tooShort = Boolean(reason) && trimmed.length < min
  const showError = touched && tooShort

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (tooShort) {
      setTouched(true)
      reasonRef.current?.focus()
      return
    }
    onConfirm(trimmed)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <form
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onSubmit={submit}
        className="w-full max-w-md space-y-4 rounded-xl bg-background p-5 shadow-xl"
      >
        <div className="space-y-1">
          <h2 id="confirm-title" className="text-base font-semibold">
            {title}
          </h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>

        {reason && (
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-reason">
              {reason.label}
              <span aria-hidden="true" className="ml-0.5 text-primary">
                *
              </span>
            </Label>
            <textarea
              id="confirm-reason"
              ref={reasonRef}
              rows={3}
              value={text}
              maxLength={500}
              placeholder={reason.placeholder}
              aria-required="true"
              aria-invalid={showError}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {showError ? (
              <p role="alert" className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {reason.tooShort}
              </p>
            ) : (
              reason.hint && <p className="text-xs text-muted-foreground">{reason.hint}</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            {cancelLabel ?? t('common.cancel')}
          </Button>
          <Button type="submit" variant={destructive ? 'destructive' : 'default'} disabled={busy}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
