export function formatScore(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toFixed(3)
}

export function formatSigned(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  const text = value.toFixed(3)
  return value > 0 ? `+${text}` : text
}

export function formatP(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value !== 0 && Math.abs(value) < 0.001) return value.toExponential(2)
  return value.toFixed(4)
}

export function formatCount(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString()
}

export function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** Format a YYYY-MM-DD trend key without shifting the calendar day through UTC. */
export function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!match) return iso
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

export function previewText(text: string, max = 72): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1)}…`
}

export function parseRouteId(raw: string | null): number | null | 'invalid' {
  if (raw == null || raw === '') return null
  return /^\d+$/.test(raw) ? Number(raw) : 'invalid'
}
