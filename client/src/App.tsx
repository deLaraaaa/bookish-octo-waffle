import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import { Toaster } from '@/components/ui/sonner'
import Login from '@/pages/Login'
import TwoFactor from '@/pages/TwoFactor'
import AuthCallback from '@/pages/AuthCallback'
import Onboarding from '@/pages/Onboarding'
import Home from '@/pages/Home'
import Manage from '@/pages/Manage'
import type { Account } from '@/lib/api'

function Protected({
  children,
  roles,
}: {
  children: React.ReactNode
  roles?: Array<NonNullable<Account['role']>>
}) {
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
  // Guarda por papel: sem o papel exigido, volta ao catálogo.
  if (roles && !(account.role && roles.includes(account.role))) {
    return <Navigate to="/" replace />
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
        <Route
          path="/manage"
          element={
            <Protected roles={['MANAGER', 'ADMIN']}>
              <Manage />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
