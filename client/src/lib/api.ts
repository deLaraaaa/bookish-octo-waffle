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

// Lê o corpo JSON da resposta; devolve null se não for JSON válido.
async function parseJson(res: Response): Promise<any> {
  try {
    return await res.json()
  } catch {
    return null
  }
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

  const data = await parseJson(res)

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
  role: 'STUDENT' | 'TEACHER' | 'MANAGER' | 'ADMIN' | null
  role_id: number | null
  institution_id: number | null
  institution_name: string | null
  institution_city: string | null
  onboarding_completed: boolean
}

export type Institution = {
  id: number
  uuid: string
  name: string
}

// Resposta paginada genérica da API (ex.: catálogo de empresas).
export type Paginated<T> = {
  items: T[]
  page: number
  pageSize: number
  hasMore: boolean
}

export type Enterprise = {
  uuid: string
  name: string
  responsible_person: string | null
  phone_number: string | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  status: string
  institution: { name: string; city: string | null } | null
  // Presente apenas para papéis privilegiados (professor/gestão); o backend
  // decide isso pelo papel do JWT — para aluno a chave nem existe.
  contracts?: Contract[]
}

export type Contract = {
  uuid: string
  name: string
  status: string
  doc_type: string
  is_primary: boolean
  due_date: string | null
  signature_status: string | null
  signed_date: string | null
  // itemId do OneDrive quando o contrato mora lá (habilita ver/baixar); null caso contrário.
  item_id?: string | null
}

// Empresa em forma mínima para dropdowns de seleção (com campos de pré-preenchimento).
export type EnterpriseOption = {
  uuid: string
  name: string
  cnpj: string | null
  responsible_person: string | null
  phone_number: string | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  contact_email: string | null
}

// Empresa criada pelo próprio usuário — inclui os contratos e seus status.
export type MyEnterprise = Omit<Enterprise, 'institution'> & {
  cnpj: string | null
  contact_email: string | null
  contracts: Contract[]
}

// Forma mínima aceita pela linha expansível (MyEnterpriseRow). Tanto MyEnterprise
// quanto um item do catálogo enriquecido com contratos são compatíveis com ela.
export type EnterpriseCard = {
  name: string
  responsible_person: string | null
  phone_number: string | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  status: string
  contracts?: Contract[]
}

export type CnpjLookup = {
  cnpj: string
  razao_social: string | null
  nome_fantasia: string | null
  street: string | null
  number: string | null
  neighborhood: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  phone_number: string | null
  already_registered: boolean
}

// POST multipart (upload opcional). O helper `api` só faz JSON, então aqui
// usamos fetch direto com o token e FormData.
export async function apiForm<T = unknown>(path: string, form: FormData): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  const data = await parseJson(res)
  if (!res.ok) {
    const message = (data && (data.Error || data.error)) || `Erro ${res.status}`
    throw new Error(message)
  }
  return data as T
}

// ---- Templates & contratos (OneDrive) ----
export type Template = {
  uuid: string
  name: string
  variables: string[]
  insert_date?: string
}

export type GeneratedContract = {
  id: string
  name: string
  size: number
  modified: string
  document_uuid?: string | null
  status?: string | null
}

// Contrato gerado ainda não vinculado a nenhuma empresa (referenciado pelo itemId).
export type LinkableContract = {
  itemId: string
  name: string
  size: number
  modified: string
}

// Baixa um arquivo autenticado (proxy do backend) e dispara o download no browser.
export async function downloadFile(path: string, filename: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// Abre um arquivo autenticado numa nova aba (ex.: visualizar o PDF do contrato).
export async function viewFile(path: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  // Revoga depois de um tempo para a nova aba conseguir carregar o conteúdo.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
