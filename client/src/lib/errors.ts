import type { TFunction } from 'i18next'

const CODIGO = /^[a-z][a-z0-9_]*$/

export function errorCode(err: unknown): string | null {
  const bruto = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const codigo = bruto.trim()
  return CODIGO.test(codigo) ? codigo : null
}

export function errorMessage(t: TFunction, err: unknown, fallbackKey: string): string {
  const codigo = errorCode(err)
  return codigo ? (t([`errors.${codigo}`, fallbackKey]) as string) : (t(fallbackKey) as string)
}

export function isSessionExpired(err: unknown): boolean {
  const codigo = errorCode(err)
  return codigo === 'invalid_token' || codigo === 'missing_token'
}
