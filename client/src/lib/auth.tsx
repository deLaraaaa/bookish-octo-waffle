import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, clearToken, getToken, type Account } from './api'

type AuthState = {
  account: Account | null
  loading: boolean
  refresh: () => Promise<Account | null>
  logout: () => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  // Compartilha a requisição em andamento: chamadas concorrentes (StrictMode,
  // telas que também chamam refresh) reaproveitam a mesma promise.
  const inflight = useRef<Promise<Account | null> | null>(null)

  function refresh(): Promise<Account | null> {
    if (inflight.current) return inflight.current

    const request = (async () => {
      if (!getToken()) {
        setAccount(null)
        return null
      }
      try {
        const data = await api<{ account: Account }>('/auth/me', { auth: true })
        setAccount(data.account)
        return data.account
      } catch {
        clearToken()
        setAccount(null)
        return null
      }
    })().finally(() => {
      // Sempre executa (sem token, sucesso ou erro): nunca deixa o inflight "preso".
      setLoading(false)
      inflight.current = null
    })

    inflight.current = request
    return request
  }

  function logout() {
    clearToken()
    setAccount(null)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <AuthContext.Provider value={{ account, loading, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
