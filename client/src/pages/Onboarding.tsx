import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Navigate, useNavigate } from 'react-router-dom'
import { api, type Institution } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LanguageSwitcher } from '@/components/language-switcher'

export default function Onboarding() {
  const { t } = useTranslation()
  const { account, loading, refresh } = useAuth()
  const navigate = useNavigate()

  const [institutions, setInstitutions] = useState<Institution[]>([])
  const [institutionId, setInstitutionId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!account) return
    api<Institution[]>('/institutions', { auth: true })
      .then(setInstitutions)
      .catch(() => setError(t('onboarding.loadUnitsError')))
  }, [account, t])

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  }
  if (!account) return <Navigate to="/login" replace />
  if (account.onboarding_completed) return <Navigate to="/" replace />

  const roleLabel = account.role ? t(`roles.${account.role}`) : t('roles.user')

  async function submit() {
    if (!institutionId) return
    setSubmitting(true)
    setError(null)
    try {
      await api('/auth/onboarding', {
        method: 'POST',
        auth: true,
        body: { institution_id: Number(institutionId) },
      })
      await refresh()
      navigate('/', { replace: true })
    } catch {
      setError(t('onboarding.saveError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative grid min-h-screen place-items-center bg-muted/40 p-4">
      <LanguageSwitcher className="absolute right-4 top-4" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">
            {t('onboarding.welcome', { name: account.name.split(' ')[0] })}
          </CardTitle>
          <CardDescription>
            <Trans
              i18nKey="onboarding.enteredAs"
              values={{ role: roleLabel }}
              components={{ b: <strong /> }}
            />
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label className="text-base">{t('onboarding.unitQuestion')}</Label>
            <RadioGroup value={institutionId} onValueChange={setInstitutionId}>
              {institutions.map((inst) => (
                <label
                  key={inst.id}
                  htmlFor={`inst-${inst.id}`}
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-3 hover:bg-accent has-[:checked]:border-primary"
                >
                  <RadioGroupItem id={`inst-${inst.id}`} value={String(inst.id)} />
                  <span className="text-sm font-medium">{inst.name}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter>
          <Button className="w-full" onClick={submit} disabled={!institutionId || submitting}>
            {submitting ? t('onboarding.submitting') : t('onboarding.submit')}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
