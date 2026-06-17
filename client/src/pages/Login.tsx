import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { API_URL } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { LanguageSwitcher } from '@/components/language-switcher'
import { BRAND, Logo, MicrosoftLogo } from '@/style'

export default function Login() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const error = params.get('error')

  const errorMessage = error
    ? t([`login.errors.${error}`, 'login.genericError'])
    : null

  return (
    <div className="relative grid min-h-screen place-items-center bg-muted/40 p-4">
      <LanguageSwitcher className="absolute right-4 top-4" />
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div
            className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-2xl shadow-sm"
            style={{
              background: `linear-gradient(135deg, ${BRAND.primaryLight}, ${BRAND.primaryDark})`,
            }}
          >
            <Logo variant="white" size={40} />
          </div>
          <CardTitle className="text-xl">{t('common.appName')}</CardTitle>
          <CardDescription>{t('login.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {errorMessage && (
            <Alert variant="destructive" className="mb-4">
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
          <Button className="w-full" asChild>
            <a href={`${API_URL}/auth/microsoft`}>
              <MicrosoftLogo size={16} className="text-white" />
              {t('login.signInWithMicrosoft')}
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
