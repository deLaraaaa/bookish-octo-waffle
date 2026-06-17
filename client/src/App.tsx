import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { Toaster } from '@/components/ui/sonner'
import Login from '@/pages/Login'
import TwoFactor from '@/pages/TwoFactor'
import AuthCallback from '@/pages/AuthCallback'
import Onboarding from '@/pages/Onboarding'
import Home from '@/pages/Home'

function Protected({ children }: { children: React.ReactNode }) {
  const { account, loading } = useAuth()
  const { t } = useTranslation()

  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center text-muted-foreground">
        {t('common.loading')}
      </div>
    )
  }
  if (!account) {
    return <Navigate to="/login" replace />
  }
  // Sessão válida mas onboarding pendente -> força o onboarding.
  if (!account.onboarding_completed) {
    return <Navigate to="/onboarding" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <AuthProvider>
      <Toaster />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/2fa" element={<TwoFactor />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route
          path="/"
          element={
            <Protected>
              <Home />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
