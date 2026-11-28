export type ScoreParse = { ok: true; values: number[] } | { ok: false; error: string }

/** Comma- or whitespace-separated finite scores. Newlines count as whitespace. */
export function parseScoreList(raw: string, label: string): ScoreParse {
  const tokens = raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  if (tokens.length === 0) {
    return { ok: false, error: `${label} is empty. Enter scores separated by commas or newlines.` }
  }

  const values: number[] = []
  for (const token of tokens) {
    const value = Number(token)
    if (!Number.isFinite(value)) {
      return { ok: false, error: `${label}: "${token}" is not a finite number.` }
    }
    values.push(value)
  }
  return { ok: true, values }
}
