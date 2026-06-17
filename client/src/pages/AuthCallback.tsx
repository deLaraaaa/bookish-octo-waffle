import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setToken } from '@/lib/api'
import { useAuth } from '@/lib/auth'

// Recebe o token de sessão de contas já verificadas (que pulam o 2FA).
export default function AuthCallback() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { refresh } = useAuth()

  useEffect(() => {
    const token = params.get('token')
    if (!token) {
      navigate('/login?error=login_failed', { replace: true })
      return
    }
    setToken(token)
    refresh().then((account) => {
      navigate(account?.onboarding_completed ? '/' : '/onboarding', { replace: true })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="grid min-h-screen place-items-center text-muted-foreground">
      {t('authCallback.signingIn')}
    </div>
  )
}
