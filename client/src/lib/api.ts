// Cliente HTTP simples para a API + gerenciamento do token de sessão (JWT).

export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'

const TOKEN_KEY = 'tcc.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

type ApiOptions = {
  method?: string
  body?: unknown
  auth?: boolean
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (opts.auth) {
    const token = getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method || 'GET',
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    const message = (data && (data.Error || data.error)) || `Erro ${res.status}`
    throw new Error(message)
  }

  return data as T
}

// Tipos da API
export type Account = {
  uuid: string
  name: string
  email: string
  status: string
  role: 'aluno' | 'professor' | null
  role_id: number | null
  institution_id: number | null
  onboarding_completed: boolean
}

export type Institution = {
  id: number
  uuid: string
  name: string
}
