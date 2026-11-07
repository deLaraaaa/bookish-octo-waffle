import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2, Sheet } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Props = {
  onExport: () => Promise<void>
  label?: string
  className?: string
}

export function ExportButton({ onExport, label, className }: Props) {
  const { t } = useTranslation()
  const [baixando, setBaixando] = useState(false)

  async function baixar() {
    setBaixando(true)
    try {
      await onExport()
      toast.success(t('export.done'))
    } catch {
      toast.error(t('export.error'))
    } finally {
      setBaixando(false)
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={baixando}
      onClick={baixar}
      className={className}
    >
      {baixando ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Sheet className="mr-1.5 h-4 w-4" />
      )}
      {baixando ? t('export.working') : label ?? t('export.label')}
    </Button>
  )
}
