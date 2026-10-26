import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { setToken } from '@/lib/api'
import { useAuth } from '@/lib/auth'

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
    async function completeLogin() {
      const account = await refresh()
      navigate(account?.onboarding_completed ? '/' : '/onboarding', { replace: true })
    }
    completeLogin()
  }, [])

  return (
    <div className="grid min-h-screen place-items-center text-muted-foreground">
      {t('authCallback.signingIn')}
    </div>
  )
}
