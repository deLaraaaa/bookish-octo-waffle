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
  item_id?: string | null
}

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

export type MyEnterprise = Omit<Enterprise, 'institution'> & {
  cnpj: string | null
  contact_email: string | null
  status: string
  insert_date?: string | null
  contracts: Contract[]
}

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

export type LinkableContract = {
  itemId: string
  name: string
  size: number
  modified: string
}

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

export async function enqueueContract(input: EnqueueContractInput): Promise<ContractJob> {
  return api<ContractJob>('/storage/contracts', { method: 'POST', auth: true, body: input })
}

export async function getContractJob(uuid: string): Promise<ContractJob> {
  return api<ContractJob>(`/storage/contracts/jobs/${uuid}`, { auth: true })
}

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

export type AuditSearchField = 'actor' | 'target'

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

export async function suggestAuditValues(field: AuditSearchField, q: string): Promise<string[]> {
  const params = new URLSearchParams({ field, q })
  return api<string[]>(`/admin/audit-logs/suggest?${params}`, { auth: true })
}

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

export async function fetchBlobUrl(path: string): Promise<string> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  return URL.createObjectURL(await res.blob())
}

export async function fetchBytes(path: string): Promise<ArrayBuffer> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  return res.arrayBuffer()
}

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

export async function viewFile(path: string): Promise<void> {
  const token = getToken()
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!res.ok) throw new Error(`Erro ${res.status}`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function nomeComData(prefixo: string): string {
  return `${prefixo}-${new Date().toISOString().slice(0, 10)}.xlsx`
}

export function exportCatalog(filtros: { search?: string; city?: string } = {}): Promise<void> {
  const qs = new URLSearchParams()
  if (filtros.search) qs.set('search', filtros.search)
  if (filtros.city) qs.set('city', filtros.city)
  const sufixo = qs.toString() ? `?${qs}` : ''
  return downloadFile(`/enterprises/export${sufixo}`, nomeComData('empresas-parceiras'))
}

export function exportManage(
  filtros: { search?: string; city?: string; status?: string } = {}
): Promise<void> {
  const qs = new URLSearchParams()
  if (filtros.search) qs.set('search', filtros.search)
  if (filtros.city) qs.set('city', filtros.city)
  if (filtros.status) qs.set('status', filtros.status)
  const sufixo = qs.toString() ? `?${qs}` : ''
  return downloadFile(`/enterprises/manage/export${sufixo}`, nomeComData('gestao-parcerias'))
}

export type LifecycleMachines = Record<string, Record<string, string[]>>

let lifecycleCache: LifecycleMachines | null = null

export async function fetchLifecycle(): Promise<LifecycleMachines> {
  if (lifecycleCache) return lifecycleCache
  const d = await api<{ machines: LifecycleMachines }>('/lifecycle', { auth: true })
  lifecycleCache = d.machines
  return lifecycleCache
}

export function resetLifecycleCache(): void {
  lifecycleCache = null
}
