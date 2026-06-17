import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { API_URL } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LanguageSwitcher } from '@/components/language-switcher'
import { Logo } from '@/style'

export default function Home() {
  const { t } = useTranslation()
  const { account, logout } = useAuth()

  const [file, setFile] = useState<File | null>(null)
  const [placeholders, setPlaceholders] = useState<string[]>([])
  const [id, setId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})

  const upload = async () => {
    if (!file) return toast.warning(t('home.selectFileFirst'))
    const fd = new FormData()
    fd.append('file', file)
    const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: fd })
    if (!res.ok) return toast.error(t('home.uploadFailed'))
    const data = await res.json()
    setId(data.id)
    setPlaceholders(data.placeholders || [])
    const init: Record<string, string> = {}
    ;(data.placeholders || []).forEach((p: string) => (init[p] = ''))
    setValues(init)
  }

  const replaceAndDownload = async () => {
    if (!id) return
    const res = await fetch(`${API_URL}/replace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, replacements: values }),
    })
    if (!res.ok) return toast.error(t('home.generateFailed'))
    const blob = await res.blob()
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'documento-gerado'
    a.click()
    URL.revokeObjectURL(url)
  }

  const roleSuffix = account?.role ? ` · ${t(`roles.${account.role}`)}` : ''

  return (
    <div className="min-h-screen bg-muted/40">
      <header className="border-b bg-background">
        <div className="container flex items-center justify-between py-4">
          <div className="flex items-center gap-3">
            <Logo size={36} />
            <div>
              <h1 className="text-lg font-semibold">{t('common.appName')}</h1>
              <p className="text-sm text-muted-foreground">
                {account?.name}
                {roleSuffix}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button variant="outline" size="sm" onClick={logout}>
              {t('home.logout')}
            </Button>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="text-xl">{t('home.templateTitle')}</CardTitle>
            <CardDescription>{t('home.templateDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept=".pdf,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <Button onClick={upload}>{t('home.send')}</Button>
            </div>

            {placeholders.length > 0 && (
              <div className="space-y-3 border-t pt-4">
                <h4 className="text-sm font-medium">{t('home.fillVariables')}</h4>
                {placeholders.map((p) => (
                  <div key={p} className="grid gap-1.5">
                    <Label htmlFor={p}>{p}</Label>
                    <Input
                      id={p}
                      value={values[p] || ''}
                      onChange={(e) => setValues({ ...values, [p]: e.target.value })}
                    />
                  </div>
                ))}
                <Button onClick={replaceAndDownload}>{t('home.generateDownload')}</Button>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
