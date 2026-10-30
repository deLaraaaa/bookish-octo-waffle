export const WAIT_WARN_DAYS = 3
export const WAIT_LATE_DAYS = 7

export type WaitTone = 'fresh' | 'warn' | 'late'

export function daysSince(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null
  const parsed = new Date(value).getTime()
  if (Number.isNaN(parsed)) return null
  return Math.max(0, Math.floor((now - parsed) / 86400000))
}

export function waitTone(days: number | null): WaitTone {
  if (days === null) return 'fresh'
  if (days >= WAIT_LATE_DAYS) return 'late'
  if (days >= WAIT_WARN_DAYS) return 'warn'
  return 'fresh'
}

export function waitToneClasses(tone: WaitTone): string {
  switch (tone) {
    case 'late':
      return 'bg-destructive/10 text-destructive'
    case 'warn':
      return 'bg-amber-100 text-amber-900'
    default:
      return 'bg-muted text-muted-foreground'
  }
}
