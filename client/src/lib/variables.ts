import type { EnterpriseOption } from '@/lib/api'

const DIACRITICS = new RegExp('[\\u0300-\\u036f]', 'g')

export function normalizeVariable(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function humanizeSegment(segment: string): string {
  const spaced = String(segment || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!spaced) return ''
  const lower = spaced.toLowerCase()
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export function humanizeVariable(name: string): string {
  const segments = String(name || '')
    .split('.')
    .map(humanizeSegment)
    .filter(Boolean)
  return segments.length ? segments.join(' › ') : String(name || '')
}

export function valueFromEnterprise(variable: string, e: EnterpriseOption): string | null {
  const addr = [e.street, e.number].filter(Boolean).join(', ')
  const full = [addr, e.neighborhood, [e.city, e.state].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(' - ')
  const map: Record<string, string | null> = {
    nome: e.name,
    razaosocial: e.name,
    razao: e.name,
    empresa: e.name,
    cnpj: e.cnpj,
    cidade: e.city,
    municipio: e.city,
    estado: e.state,
    uf: e.state,
    bairro: e.neighborhood,
    rua: e.street,
    logradouro: e.street,
    numero: e.number,
    cep: e.zip_code,
    endereco: full || null,
    telefone: e.phone_number,
    fone: e.phone_number,
    responsavel: e.responsible_person,
    contato: e.responsible_person,
    email: e.contact_email,
  }
  return map[normalizeVariable(variable)] ?? null
}
