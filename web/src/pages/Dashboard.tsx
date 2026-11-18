import { Link } from 'react-router-dom'
import {
  getDemoPrompts,
  getDemoTraces,
  getOverview,
  getScans,
  getTraces,
  type Scan,
  type Trace,
} from '../api'
import { Button, EmptyState, ErrorState, LoadingState, VerdictBadge } from '../components/ui'
import { formatCount, formatScore, formatWhen, previewText } from '../lib/format'
import { caseStory } from '../lib/stories'
import { useAsync } from '../lib/useAsync'

type CaseFile = {
  kind: 'scan' | 'trace'
  id: number
  title: string
  score: number
  flagged: boolean
  created_at: string
  categories: string[]
  signals: string[]
  href: string
  story: string
}

function stamp(iso: string): number {
  const value = Date.parse(iso)
  return Number.isNaN(value) ? 0 : value
}

function toCase(kind: 'scan' | 'trace', row: Scan | Trace): CaseFile {
  const categories = row.categories ?? []
  const signals = row.signals ?? []
  const story = caseStory({ kind, flagged: row.flagged, score: row.score, signals, categories })
  if (kind === 'trace' && 'trace_id' in row) {
    return {
      kind,
      id: row.id,
      title: row.trace_id || `Trace #${row.id}`,
      score: row.score,
      flagged: row.flagged,
      created_at: row.created_at,
      categories,
      signals,
      href: `/traces?id=${row.id}`,
      story,
    }
  }
  return {
    kind: 'scan',
    id: row.id,
    title: `Scan #${row.id}`,
    score: row.score,
    flagged: row.flagged,
    created_at: row.created_at,
    categories,
    signals,
    href: `/scan?id=${row.id}`,
    story,
  }
}

function CountPair({ label, total, flagged }: { label: string; total: number; flagged: number }) {
  return (
    <p className="text-sm">
      <span className="text-muted">{label}</span>{' '}
      <span className="font-mono tabular-nums">{formatCount(total)}</span>
      <span className="text-muted"> · </span>
      <span className={`font-mono tabular-nums ${flagged > 0 ? 'text-danger' : 'text-muted'}`}>
        {formatCount(flagged)} flagged
      </span>
    </p>
  )
}

export function DashboardPage() {
  const overview = useAsync(getOverview)
  const scans = useAsync(() => getScans(50))
  const traces = useAsync(() => getTraces(50))
  const demoPrompts = useAsync(getDemoPrompts)
  const demoTraces = useAsync(getDemoTraces)

  function refresh() {
    overview.reload()
    scans.reload()
    traces.reload()
    demoPrompts.reload()
    demoTraces.reload()
  }

  const cases: CaseFile[] = [
    ...(scans.data?.items ?? []).map((row) => toCase('scan', row)),
    ...(traces.data?.items ?? []).map((row) => toCase('trace', row)),
  ].sort((a, b) => stamp(b.created_at) - stamp(a.created_at) || b.id - a.id)

  const casesWaiting = !scans.data && !traces.data && (scans.loading || traces.loading)
  const categories = overview.data?.categories ?? []

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border border-line bg-card px-4 py-3">
        {overview.loading && !overview.data ? <p className="text-sm text-muted">Loading counts…</p> : null}
        {overview.error && !overview.data ? (
          <div className="min-w-0 flex-1">
            <ErrorState message={overview.error} onRetry={overview.reload} />
          </div>
        ) : null}
        {overview.data ? (
          <>
            <CountPair
              label="Scans"
              total={overview.data.scans.total}
              flagged={overview.data.scans.flagged}
            />
            <CountPair
              label="Traces"
              total={overview.data.traces.total}
              flagged={overview.data.traces.flagged}
            />
            {categories.length > 0 ? (
              <ul className="flex min-w-0 basis-full flex-wrap gap-x-3 gap-y-1 text-xs text-muted sm:basis-auto sm:flex-1">
                {categories.map((row) => (
                  <li key={row.category} className="font-mono">
                    {row.category} {formatCount(row.count)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No categories yet.</p>
            )}
          </>
        ) : null}
        <Button variant="ghost" onClick={refresh} className="ml-auto">
          Refresh
        </Button>
      </div>
      {overview.error && overview.data ? <ErrorState message={overview.error} onRetry={overview.reload} /> : null}

      <section className="border border-line bg-ink px-5 py-6 sm:px-8 sm:py-8">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted">Intake</p>
        <h2 className="mt-2 max-w-xl text-4xl font-semibold tracking-tight sm:text-5xl">Inspect something</h2>
        <p className="mt-3 max-w-lg text-sm text-muted">
          A prompt gets dissected sentence by sentence. An agent trace gets replayed until the step that gets caught.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Link to="/scan" className="block border border-line px-4 py-4 hover:border-fg">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">01 · Prompt</span>
            <span className="mt-2 block text-xl font-semibold">Open dissection</span>
            <span className="mt-1 block text-sm text-muted">Paste wording, or start from a blank page.</span>
          </Link>
          <Link to="/traces" className="block border border-line px-4 py-4 hover:border-fg">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">02 · Agent trace</span>
            <span className="mt-2 block text-xl font-semibold">Open the theater</span>
            <span className="mt-1 block text-sm text-muted">Load a trace and play it from the first step.</span>
          </Link>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted">Demo cases</h2>
        </div>
        {demoTraces.loading && !demoTraces.data ? <LoadingState label="Loading demo traces…" /> : null}
        {demoTraces.error ? <ErrorState message={demoTraces.error} onRetry={demoTraces.reload} /> : null}
        {demoPrompts.loading && !demoPrompts.data ? <LoadingState label="Loading demo prompts…" /> : null}
        {demoPrompts.error ? <ErrorState message={demoPrompts.error} onRetry={demoPrompts.reload} /> : null}
        {demoTraces.data && demoTraces.data.length === 0 && demoPrompts.data && demoPrompts.data.length === 0 ? (
          <EmptyState title="No demo cases" body="The demo files are missing or empty on the server." />
        ) : null}
        {demoTraces.data && demoTraces.data.length > 0 ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {demoTraces.data.map((demo) => (
              <li key={demo.trace_id}>
                <Link
                  to={`/traces?demo=${encodeURIComponent(demo.trace_id)}`}
                  className="flex h-full flex-col border border-line bg-card px-4 py-4 hover:border-fg"
                >
                  <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{demo.label}</span>
                  <span className="mt-2 text-base font-medium">{demo.title ?? demo.trace_id}</span>
                  <span className="mt-auto pt-3 text-xs text-muted">
                    {demo.steps.length} steps · Open case
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
        {demoPrompts.data && demoPrompts.data.length > 0 ? (
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {demoPrompts.data.map((prompt, index) => (
              <li key={`${prompt.label}-${index}`} className="shrink-0">
                <Link
                  to={`/scan?demo=${index}`}
                  title={prompt.text}
                  className="block w-64 border border-line bg-card px-3 py-3 hover:border-fg"
                >
                  <span className="text-[11px] uppercase tracking-wide text-muted">
                    {prompt.category ?? 'benign'} · {prompt.label}
                  </span>
                  <span className="mt-1 block text-sm">{previewText(prompt.text, 88)}</span>
                  <span className="mt-2 block text-xs text-muted">Open case</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-[0.16em] text-muted">Stored cases</h2>
        {casesWaiting ? <LoadingState label="Loading stored scans and traces…" /> : null}
        {scans.error ? <ErrorState message={`Scans: ${scans.error}`} onRetry={scans.reload} /> : null}
        {traces.error ? <ErrorState message={`Traces: ${traces.error}`} onRetry={traces.reload} /> : null}
        {!casesWaiting && cases.length === 0 && !scans.error && !traces.error ? (
          <EmptyState title="No cases on file" body="Scans and traces you run are stored and listed here, newest first." />
        ) : null}
        {cases.length > 0 ? (
          <ul className="space-y-3">
            {cases.map((item) => (
              <li key={`${item.kind}-${item.id}`}>
                <Link to={item.href} className="block border border-line bg-card px-4 py-4 hover:border-fg">
                  <p className="text-lg leading-snug">{item.story}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="border border-line px-1.5 py-0.5 font-mono uppercase tracking-wide">
                      {item.kind === 'scan' ? 'Scan' : 'Trace'}
                    </span>
                    <span className="min-w-0 truncate font-mono text-muted">{item.title}</span>
                    <VerdictBadge flagged={item.flagged} />
                    <span className="ml-auto font-mono tabular-nums">{formatScore(item.score)}</span>
                  </div>
                  <p className="mt-2 text-xs text-muted">
                    {formatWhen(item.created_at)}
                    {item.categories.length > 0 ? ` · ${item.categories.join(', ')}` : ''}
                  </p>
                  {item.signals.length > 0 ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted">{item.signals.slice(0, 4).join(' · ')}</p>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  )
}
