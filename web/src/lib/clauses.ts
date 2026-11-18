/** Whole-text dissection scores at most this many clauses. The tail folds into the last one. */
export const CLAUSE_CAP = 12

export type ClauseSlice = {
  text: string
  /** Trimmed text sent to POST /api/scan. Null for whitespace-only glue. */
  scanText: string | null
  start: number
  end: number
}

function pushSlice(slices: ClauseSlice[], source: string, start: number, end: number) {
  if (end <= start) return
  const text = source.slice(start, end)
  const scanText = text.trim()
  slices.push({ text, scanText: scanText.length > 0 ? scanText : null, start, end })
}

/**
 * Split on sentence punctuation, semicolons, and newlines.
 * A period inside a number (0.85) or a token (example.com) is not a boundary.
 * The slices concatenate back to the original string.
 */
export function splitClauses(source: string, cap = CLAUSE_CAP): ClauseSlice[] {
  const raw: ClauseSlice[] = []
  let start = 0
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? ''
    const next = source[index + 1]
    const atEnd = index === source.length - 1
    if (char === '\n') {
      pushSlice(raw, source, start, index + 1)
      start = index + 1
      continue
    }
    const punctuation = char === ';' || char === '.' || char === '!' || char === '?'
    const boundary = punctuation && (atEnd || next === undefined || /\s/.test(next))
    if (!boundary && !atEnd) continue
    let end = index
    if (punctuation) {
      while (end + 1 < source.length && /[.!?]/.test(source[end + 1] ?? '')) end += 1
      while (end + 1 < source.length && /[ \t]/.test(source[end + 1] ?? '')) end += 1
    }
    pushSlice(raw, source, start, end + 1)
    start = end + 1
    index = end
  }
  if (start < source.length) pushSlice(raw, source, start, source.length)

  const covered = raw.map((slice) => slice.text).join('') === source
  const slices = covered
    ? raw
    : [{ text: source, scanText: source.trim() || null, start: 0, end: source.length }]
  return capSlices(slices, cap)
}

function capSlices(slices: ClauseSlice[], cap: number): ClauseSlice[] {
  const scored = slices.flatMap((slice, index) => (slice.scanText ? [index] : []))
  if (scored.length <= cap) return slices
  const cut = scored[cap - 1]
  if (cut === undefined) return slices
  const head = slices.slice(0, cut)
  const tail = slices.slice(cut)
  const text = tail.map((slice) => slice.text).join('')
  const first = tail[0]
  const last = tail[tail.length - 1]
  if (!first || !last) return slices
  return [
    ...head,
    {
      text,
      scanText: text.trim() || null,
      start: first.start,
      end: last.end,
    },
  ]
}

export function scoredClauseCount(slices: readonly ClauseSlice[]): number {
  return slices.filter((slice) => slice.scanText).length
}

/** Red wash and underline scaled by score. Clean clauses return null and stay plain. */
export function clauseHeat(
  score: number,
  flagged: boolean,
): { backgroundColor: string; boxShadow: string } | null {
  const finite = typeof score === 'number' && Number.isFinite(score) ? score : 0
  if (!flagged && finite < 0.5) return null
  const amount = Math.min(1, Math.max(0.35, finite))
  const wash = Math.round(10 + amount * 18)
  const line = Math.round(45 + amount * 55)
  return {
    backgroundColor: `color-mix(in srgb, var(--danger) ${wash}%, transparent)`,
    boxShadow: `inset 0 -2px 0 color-mix(in srgb, var(--danger) ${line}%, transparent)`,
  }
}
