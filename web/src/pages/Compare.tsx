import { useState, type KeyboardEvent } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COMPARE_ALPHA, errorMessage, postCompare, type CompareResult } from '../api'
import { Button, EmptyState, ErrorState, GateBadge, LoadingState, Panel, Stat, TextArea } from '../components/ui'
import { EXAMPLE_COMPARISON } from '../lib/exampleComparison'
import { formatCount, formatP, formatScore, formatSigned } from '../lib/format'
import { parseScoreList } from '../lib/scores'

type CompareView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; title: string; message: string }
  | {
      status: 'ready'
      result: CompareResult
      baseline: number[]
      candidate: number[]
      source: 'example' | 'custom'
    }

type PairRow = {
  pair: number
  baseline: number
  candidate: number
  diff: number
  fill: string
}

const axisTick = { fill: 'var(--muted)', fontSize: 11 }

function diffFill(diff: number): string {
  if (diff < 0) return 'var(--chart-flag)'
  if (diff > 0) return 'var(--chart-1)'
  return 'var(--chart-2)'
}

function pairRows(baseline: number[], candidate: number[]): PairRow[] {
  const count = Math.min(baseline.length, candidate.length)
  const rows: PairRow[] = []
  for (let index = 0; index < count; index += 1) {
    const base = baseline[index] ?? 0
    const next = candidate[index] ?? 0
    const diff = next - base
    rows.push({
      pair: index + 1,
      baseline: base,
      candidate: next,
      diff,
      fill: diffFill(diff),
    })
  }
  return rows
}

function diffDomain(values: number[]): [number, number] {
  let min = 0
  let max = 0
  for (const value of values) {
    if (Number.isFinite(value) && value < min) min = value
    if (Number.isFinite(value) && value > max) max = value
  }
  const span = max - min
  const pad = span === 0 ? 0.05 : span * 0.12
  return [min - pad, max + pad]
}

export function ComparePage() {
  const [baselineText, setBaselineText] = useState('')
  const [candidateText, setCandidateText] = useState('')
  const [usingExample, setUsingExample] = useState(false)
  const [view, setView] = useState<CompareView>({ status: 'idle' })

  async function run(baselineRaw: string, candidateRaw: string, source: 'example' | 'custom') {
    const baseline = parseScoreList(baselineRaw, 'Baseline')
    if (!baseline.ok) {
      setView({ status: 'error', title: 'Check the baseline scores', message: baseline.error })
      return
    }
    const candidate = parseScoreList(candidateRaw, 'Candidate')
    if (!candidate.ok) {
      setView({ status: 'error', title: 'Check the candidate scores', message: candidate.error })
      return
    }
    if (baseline.values.length < 2 || candidate.values.length < 2) {
      setView({
        status: 'error',
        title: 'Need more scores',
        message: 'Each list needs at least 2 scores.',
      })
      return
    }
    if (baseline.values.length !== candidate.values.length) {
      setView({
        status: 'error',
        title: 'Lists do not match',
        message: `Baseline has ${baseline.values.length} scores and candidate has ${candidate.values.length}. The two lists need the same length.`,
      })
      return
    }

    setView({ status: 'loading' })
    try {
      const result = await postCompare(baseline.values, candidate.values)
      setView({
        status: 'ready',
        result,
        baseline: baseline.values,
        candidate: candidate.values,
        source,
      })
    } catch (err) {
      setView({ status: 'error', title: 'Request failed', message: errorMessage(err) })
    }
  }

  function loadExample() {
    setBaselineText(EXAMPLE_COMPARISON.baseline)
    setCandidateText(EXAMPLE_COMPARISON.candidate)
    setUsingExample(true)
    void run(EXAMPLE_COMPARISON.baseline, EXAMPLE_COMPARISON.candidate, 'example')
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void run(baselineText, candidateText, 'custom')
    }
  }

  const rows = view.status === 'ready' ? pairRows(view.baseline, view.candidate) : []
  const domain = view.status === 'ready' ? diffDomain([...rows.map((row) => row.diff), view.result.mean_diff]) : [0, 1]

  return (
    <div className="space-y-6">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          void run(baselineText, candidateText, usingExample ? 'example' : 'custom')
        }}
      >
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Baseline">
            <label htmlFor="baseline-scores" className="mb-2 block text-xs text-muted">
              Scores separated by commas or newlines
            </label>
            <TextArea
              id="baseline-scores"
              rows={8}
              value={baselineText}
              spellCheck={false}
              placeholder="0.80, 0.75, 0.90"
              onChange={(event) => {
                setBaselineText(event.target.value)
                setUsingExample(false)
              }}
              onKeyDown={onKeyDown}
            />
          </Panel>
          <Panel title="Candidate">
            <label htmlFor="candidate-scores" className="mb-2 block text-xs text-muted">
              Same length as the baseline, same order
            </label>
            <TextArea
              id="candidate-scores"
              rows={8}
              value={candidateText}
              spellCheck={false}
              placeholder="0.60, 0.55, 0.70"
              onChange={(event) => {
                setCandidateText(event.target.value)
                setUsingExample(false)
              }}
              onKeyDown={onKeyDown}
            />
          </Panel>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={view.status === 'loading'}>
            {view.status === 'loading' ? 'Comparing…' : 'Compare'}
          </Button>
          <Button type="button" variant="ghost" onClick={loadExample} disabled={view.status === 'loading'}>
            Load example comparison
          </Button>
          <p className="text-xs text-muted">Ctrl+Enter runs the comparison. Alpha sent to the API is {COMPARE_ALPHA}.</p>
        </div>
        <p className="max-w-3xl text-xs text-muted">
          The API has no comparison demo. Load example comparison fills both boxes with scores that ship in the UI,
          labeled as example input, then asks the API to score them.
        </p>
        {usingExample ? (
          <p className="rounded-lg border border-line bg-card px-3 py-2 text-sm text-fg">
            Example input. These scores are not from the API or the demo files.
            {view.status === 'ready' && view.source === 'example'
              ? ' The statistics below are the API response for this example.'
              : ''}
          </p>
        ) : null}
      </form>

      <div aria-live="polite" className="space-y-4">
        {view.status === 'loading' ? <LoadingState label="Running comparison…" /> : null}
        {view.status === 'error' ? <ErrorState title={view.title} message={view.message} /> : null}
        {view.status === 'idle' ? (
          <EmptyState
            title="No comparison yet"
            body="Paste two score lists, or load the built-in example, then run the comparison."
          />
        ) : null}
        {view.status === 'ready' ? (
          <>
            <div
              className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border px-4 py-4 ${
                view.result.gate === 'FAIL' ? 'danger-soft' : 'border-line bg-card'
              }`}
            >
              <div>
                <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Gate</div>
                <div className="mt-1 flex items-center gap-3">
                  <span className="font-mono text-2xl text-fg">{view.result.gate}</span>
                  <GateBadge gate={view.result.gate} />
                </div>
              </div>
              <p className="max-w-md text-sm text-muted">
                FAIL when the confidence interval upper bound is below 0, which the API treats as the candidate being
                worse. Otherwise PASS.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <Stat label="Pairs" value={formatCount(view.result.n)} />
              <Stat label="Baseline mean" value={formatScore(view.result.baseline_mean)} />
              <Stat label="Candidate mean" value={formatScore(view.result.candidate_mean)} />
              <Stat
                label="Mean difference"
                value={formatSigned(view.result.mean_diff)}
                hint="candidate − baseline"
                tone={view.result.mean_diff < 0 ? 'danger' : 'default'}
              />
              <Stat
                label="95% CI"
                value={`${formatSigned(view.result.ci_low)} to ${formatSigned(view.result.ci_high)}`}
                hint={`Paired bootstrap, α = ${COMPARE_ALPHA}`}
              />
              <Stat
                label="McNemar p"
                value={formatP(view.result.mcnemar_p)}
                hint="A case passes when its score is at least 0.5"
              />
            </div>
            <Panel title="Paired differences">
              <p className="mb-3 text-xs text-muted">
                Each bar is candidate minus baseline for one submitted pair. The dashed line is mean_diff from the
                API. A negative bar means the candidate scored lower, which the gate treats as worse.
              </p>
              <div className="h-80 w-full min-w-0" role="group" aria-label="Paired differences">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--line)" />
                    <XAxis dataKey="pair" tick={axisTick} tickFormatter={(value) => String(value)} />
                    <YAxis
                      domain={domain}
                      width={56}
                      tick={axisTick}
                      tickFormatter={(value) => Number(value).toFixed(2)}
                    />
                    <Tooltip
                      formatter={(value) => [formatSigned(typeof value === 'number' ? value : Number(value)), 'Difference']}
                      labelFormatter={(label) => `Pair ${label}`}
                    />
                    <ReferenceLine y={0} stroke="var(--chart-2)" />
                    {Number.isFinite(view.result.mean_diff) ? (
                      <ReferenceLine
                        y={view.result.mean_diff}
                        stroke="var(--chart-3)"
                        strokeDasharray="4 4"
                        label={{ value: 'mean diff', fill: 'var(--chart-3)', fontSize: 11 }}
                      />
                    ) : null}
                    <Bar dataKey="diff" name="Difference" radius={[3, 3, 0, 0]} maxBarSize={36} minPointSize={2} isAnimationActive={false}>
                      {rows.map((row) => (
                        <Cell key={row.pair} fill={row.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-fg" aria-hidden="true" />
                  Candidate higher
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-danger" aria-hidden="true" />
                  Candidate lower
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm" style={{ background: 'var(--chart-3)' }} aria-hidden="true" />
                  API mean difference
                </span>
              </p>
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-muted">View pairs</summary>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-muted">
                      <tr>
                        <th className="py-1 font-medium">Pair</th>
                        <th className="py-1 text-right font-medium">Baseline</th>
                        <th className="py-1 text-right font-medium">Candidate</th>
                        <th className="py-1 text-right font-medium">Candidate − baseline</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {rows.map((row) => (
                        <tr key={row.pair} className="border-t border-line">
                          <td className="py-1">{row.pair}</td>
                          <td className="py-1 text-right tabular-nums">{formatScore(row.baseline)}</td>
                          <td className="py-1 text-right tabular-nums">{formatScore(row.candidate)}</td>
                          <td className="py-1 text-right tabular-nums">{formatSigned(row.diff)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </Panel>
          </>
        ) : null}
      </div>
    </div>
  )
}
