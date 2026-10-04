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
  institution: { name: string; city: string | null } | null
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
  status: string
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

// Job de geração assíncrona de contrato. O POST enfileira e devolve { uuid, status };
// o front acompanha por polling até done/failed. `result`/`error` só vêm no terminal.
export type ContractJobStatus = 'queued' | 'processing' | 'done' | 'failed'

export type ContractJob = {
  uuid: string
  status: ContractJobStatus
  out_name?: string
  enterprise_uuid?: string | null
  result?: {
    docx?: { id: string; name: string }
    pdf?: { id: string; name: string }
    linked?: { enterpriseUuid: string; document_uuid: string }
  } | null
  error?: string | null
  insert_date?: string
  finished_at?: string | null
}

type EnqueueContractInput = {
  templateUuid: string
  values: Record<string, string>
  outName: string
  asPdf: boolean
  enterpriseUuid?: string
}

// Enfileira a geração de um contrato. Retorna o job recém-criado (status 'queued').
export async function enqueueContract(input: EnqueueContractInput): Promise<ContractJob> {
  return api<ContractJob>('/storage/contracts', { method: 'POST', auth: true, body: input })
}

export async function getContractJob(uuid: string): Promise<ContractJob> {
  return api<ContractJob>(`/storage/contracts/jobs/${uuid}`, { auth: true })
}

// Faz polling do job até um estado terminal (done/failed) ou estourar o timeout.
export async function pollContractJob(
  uuid: string,
  { intervalMs = 1500, timeoutMs = 120_000 }: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<ContractJob> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const job = await getContractJob(uuid)
    if (job.status === 'done' || job.status === 'failed') return job
    if (Date.now() > deadline) throw new Error('job_timeout')
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

// ---- Admin (contas com papel de Gestor + trilha de auditoria) ----
export type ManagerInvite = {
  email: string
  consumed: boolean
  invited_at: string
}

export type Manager = {
  uuid: string
  name: string
  email: string | null
}

export type AuditLog = {
  id: number
  actor_email: string | null
  action: string
  entity: string
  entity_ref: string | null
  detail: Record<string, unknown> | null
  insert_date: string
}

export async function listManagers(): Promise<Manager[]> {
  return api<Manager[]>('/admin/managers', { auth: true })
}

// Rebaixa um Gestor. Vale a partir do próximo login (o papel vive no JWT).
export async function demoteManager(uuid: string): Promise<void> {
  await api(`/admin/managers/${uuid}`, { method: 'DELETE', auth: true })
}

export async function listManagerInvites(): Promise<ManagerInvite[]> {
  return api<ManagerInvite[]>('/admin/manager-invites', { auth: true })
}

export async function inviteManager(email: string): Promise<{ email: string; promoted_now: boolean }> {
  return api('/admin/manager-invites', { method: 'POST', auth: true, body: { email } })
}

export async function revokeManagerInvite(email: string): Promise<void> {
  await api(`/admin/manager-invites/${encodeURIComponent(email)}`, { method: 'DELETE', auth: true })
}

// Campo com autocomplete da trilha: autor (e-mail) ou alvo do registro.
export type AuditSearchField = 'actor' | 'target'

// Filtros combináveis (AND), um por coluna; from/to no formato 'YYYY-MM-DD'.
export async function listAuditLogs(opts: {
  actor?: string
  target?: string
  action?: string
  from?: string
  to?: string
  page?: number
}): Promise<Paginated<AuditLog>> {
  const params = new URLSearchParams({ page: String(opts.page || 1) })
  for (const key of ['actor', 'target', 'action', 'from', 'to'] as const) {
    if (opts[key]) params.set(key, opts[key])
  }
  return api<Paginated<AuditLog>>(`/admin/audit-logs?${params}`, { auth: true })
}

// Autocomplete do filtro: valores já registrados na trilha que casam com q.
export async function suggestAuditValues(field: AuditSearchField, q: string): Promise<string[]> {
  const params = new URLSearchParams({ field, q })
  return api<string[]>(`/admin/audit-logs/suggest?${params}`, { auth: true })
}

// ---- Chancelas (seals) ----
export type Seal = { uuid: string; name: string; itemId: string }

export async function listSeals(): Promise<Seal[]> {
  const d = await api<{ seals: Seal[] }>('/storage/seals', { auth: true })
  return d.seals
}

export async function uploadSeal(file: File): Promise<Seal> {
  const fd = new FormData()
  fd.append('file', file)
  return apiForm<Seal>('/storage/seals', fd)
}

// Aplica uma chancela num PDF de contrato. Posição em frações (0..1) do tamanho da
// página, medidas do canto superior-esquerdo. Retorna o novo PDF gerado.
export type StampInput = {
  sealUuid: string
  xFrac: number
  yFracTop: number
  widthFrac: number
  page: number
  name: string
}

export async function stampContract(itemId: string, input: StampInput): Promise<{ id: string; name: string }> {
  return api<{ id: string; name: string }>(`/storage/contracts/${itemId}/stamp`, {
    method: 'POST',
    auth: true,
    body: input,
  })
}

// Busca um arquivo autenticado e devolve um object URL (ex.: imagem da chancela).
export async function fetchBlobUrl(path: string): Promise<string> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

// Busca os bytes de um arquivo autenticado (ex.: PDF para o pdf.js renderizar).
export async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  return res.arrayBuffer()
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
