import { formatScore } from '../lib/format'

export function ScoreGauge({
  score,
  flagged,
  size = 'md',
}: {
  score: number
  flagged: boolean
  size?: 'sm' | 'md'
}) {
  const finite = typeof score === 'number' && Number.isFinite(score) ? score : 0
  const clamped = Math.min(1, Math.max(0, finite))
  const radius = 52
  const circumference = 2 * Math.PI * radius
  const dash = clamped * circumference
  const color = flagged ? 'var(--danger)' : 'var(--fg)'
  const box = size === 'sm' ? 'h-20 w-20' : 'h-32 w-32'
  const number = size === 'sm' ? 'text-base' : 'text-xl'

  return (
    <div
      className={`relative shrink-0 ${box}`}
      role="img"
      aria-label={`Score ${formatScore(score)}, ${flagged ? 'flagged' : 'clean'}`}
    >
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="var(--line)" strokeWidth="8" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap={clamped > 0 ? 'round' : 'butt'}
          strokeDasharray={`${dash} ${circumference - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono tabular-nums ${number}`}>{formatScore(score)}</span>
        <span className="text-[10px] uppercase tracking-wide text-muted">score</span>
      </div>
    </div>
  )
}
