import { useTranslation } from 'react-i18next'
import { Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

// Alterna entre português e inglês.
export function LanguageSwitcher({ className }: { className?: string }) {
  const { i18n } = useTranslation()
  const current = i18n.resolvedLanguage === 'en' ? 'en' : 'pt'
  const next = current === 'pt' ? 'en' : 'pt'

  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('text-muted-foreground', className)}
      onClick={() => i18n.changeLanguage(next)}
      title={next === 'en' ? 'Switch to English' : 'Mudar para Português'}
    >
      <Languages className="mr-1 h-4 w-4" />
      {current.toUpperCase()}
    </Button>
  )
}
