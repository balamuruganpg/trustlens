import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  errorMessage,
  getDemoTraces,
  getTrace,
  postTrace,
  type DemoTrace,
  type Trace,
  type TraceInput,
  type TraceStepInput,
  type TraceStepResult,
} from '../api'
import { ScoreGauge } from '../components/ScoreGauge'
import {
  Button,
  CategoryChips,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  TextArea,
  VerdictBadge,
} from '../components/ui'
import { formatScore, formatWhen, parseRouteId } from '../lib/format'
import { flowChips, flowKindLabel, type FlowChip } from '../lib/flow'
import { isIncident, riskSwatch } from '../lib/risk'
import { matchSignal } from '../lib/stories'
import { parseTraceJson } from '../lib/traceInput'
import { useAsync } from '../lib/useAsync'

type TraceView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; title: string; message: string; retry: boolean }
  | { status: 'ready'; trace: Trace; source: 'new' | 'stored'; submitted: TraceInput | null }

const PLAYBACK_MS = 900

const demoFlights = new Map<string, Promise<{ trace: Trace; submitted: TraceInput }>>()

function inspectDemo(demo: DemoTrace): Promise<{ trace: Trace; submitted: TraceInput }> {
  const existing = demoFlights.get(demo.trace_id)
  if (existing) return existing
  const parsed = parseTraceJson(JSON.stringify(demo))
  if (!parsed.ok) return Promise.reject(new Error(parsed.error))
  const flight = postTrace(parsed.trace).then((trace) => ({ trace, submitted: parsed.trace }))
  demoFlights.set(demo.trace_id, flight)
  const clear = () => {
    if (demoFlights.get(demo.trace_id) === flight) demoFlights.delete(demo.trace_id)
  }
  flight.then(clear, clear)
  return flight
}

function excerpt(text: string, max = 600): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false }
  return { text: `${text.slice(0, max)}…`, truncated: true }
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(target.closest('textarea, input, select, [contenteditable="true"]'))
}

export function TraceInspectorPage() {
  const demos = useAsync(getDemoTraces)
  const [params, setParams] = useSearchParams()
  const routeId = parseRouteId(params.get('id'))
  const demoKey = params.get('demo')
  const [raw, setRaw] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [view, setView] = useState<TraceView>({ status: 'idle' })
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<1 | 2>(1)
  const [pulseKey, setPulseKey] = useState(0)
  const [held, setHeld] = useState(false)
  const request = useRef(0)
  const shownId = useRef<number | null>(null)
  const lastDraft = useRef<TraceInput | null>(null)
  const pendingPlayback = useRef<number | null>(null)
  const caught = useRef(false)

  const traceKey = view.status === 'ready' ? view.trace.id : -1
  const [boundTrace, setBoundTrace] = useState(traceKey)
  if (boundTrace !== traceKey) {
    setBoundTrace(traceKey)
    setIndex(0)
    setPlaying(false)
    setHeld(false)
    pendingPlayback.current = null
    caught.current = false
  }

  const steps = view.status === 'ready' ? (view.trace.steps ?? []) : []
  const position = steps.length === 0 ? 0 : Math.min(index, steps.length - 1)
  const current = steps[position]
  const submittedSteps = view.status === 'ready' ? view.submitted?.steps : undefined
  const submittedHere: TraceStepInput | null = submittedSteps?.[position] ?? null

  const loadStored = useCallback((id: number) => {
    const ticket = ++request.current
    setView({ status: 'loading' })
    getTrace(id)
      .then((trace) => {
        if (request.current !== ticket) return
        shownId.current = trace.id
        setView({ status: 'ready', trace, source: 'stored', submitted: null })
      })
      .catch((err: unknown) => {
        if (request.current === ticket) {
          setView({ status: 'error', title: 'Request failed', message: errorMessage(err), retry: false })
        }
      })
  }, [])

  useEffect(() => {
    if (typeof routeId !== 'number') return
    if (shownId.current === routeId) return
    loadStored(routeId)
  }, [routeId, loadStored])

  useEffect(() => {
    if (typeof routeId === 'number' || routeId === 'invalid') return
    if (!demoKey || !demos.data) return
    const demoIndex = demos.data.findIndex((demo) => demo.trace_id === demoKey)
    const demo = demoIndex >= 0 ? demos.data[demoIndex] : undefined
    if (!demo) {
      setView({
        status: 'error',
        title: 'Demo not found',
        message: `No demo trace with id ${demoKey}.`,
        retry: false,
      })
      return
    }
    const ticket = ++request.current
    setSelected(demoIndex)
    setRaw(JSON.stringify(demo, null, 2))
    setView({ status: 'loading' })
    let cancelled = false
    inspectDemo(demo).then(
      ({ trace, submitted }) => {
        if (cancelled || request.current !== ticket) return
        shownId.current = trace.id
        lastDraft.current = submitted
        setView({ status: 'ready', trace, source: 'new', submitted })
        setParams({ id: String(trace.id) }, { replace: true })
      },
      (err: unknown) => {
        if (cancelled || request.current !== ticket) return
        setView({ status: 'error', title: 'Request failed', message: errorMessage(err), retry: true })
      },
    )
    return () => {
      cancelled = true
    }
  }, [demoKey, demos.data, routeId, setParams])

  useEffect(() => {
    if (!playing) return
    if (steps.length === 0 || position >= steps.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => {
      const next = position + 1
      pendingPlayback.current = next
      setIndex(next)
    }, PLAYBACK_MS / speed)
    return () => window.clearTimeout(timer)
  }, [playing, position, speed, steps.length])

  useEffect(() => {
    if (view.status !== 'ready') return
    const list = view.trace.steps ?? []
    const first = list.findIndex((step) => isIncident(step.risk))
    if (first >= 0 && position < first) {
      caught.current = false
      setHeld(false)
    }
    if (pendingPlayback.current !== position) return
    pendingPlayback.current = null
    const step = list[position]
    if (!step || !isIncident(step.risk)) return
    setPulseKey((value) => value + 1)
    if (position === first && !caught.current) {
      caught.current = true
      setHeld(true)
      setPlaying(false)
    }
  }, [position, view])

  const jump = useCallback(
    (nextPosition: number) => {
      if (steps.length === 0) return
      const next = Math.max(0, Math.min(steps.length - 1, nextPosition))
      pendingPlayback.current = null
      setPlaying(false)
      setIndex(next)
    },
    [steps.length],
  )

  const onPlayPause = useCallback(() => {
    if (steps.length === 0) return
    if (playing) {
      setPlaying(false)
      return
    }
    if (position >= steps.length - 1) {
      caught.current = false
      pendingPlayback.current = null
      setHeld(false)
      setIndex(0)
    }
    setHeld(false)
    setPlaying(true)
  }, [playing, position, steps.length])

  useEffect(() => {
    if (view.status !== 'ready') return
    function onKey(event: globalThis.KeyboardEvent) {
      if (typingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key === ' ') {
        event.preventDefault()
        onPlayPause()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        jump(position + 1)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        jump(position - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jump, onPlayPause, position, view.status])

  async function submit(draft: TraceInput) {
    lastDraft.current = draft
    const ticket = ++request.current
    setView({ status: 'loading' })
    try {
      const trace = await postTrace(draft)
      if (request.current !== ticket) return
      shownId.current = trace.id
      setView({ status: 'ready', trace, source: 'new', submitted: draft })
      setParams({ id: String(trace.id) }, { replace: true })
    } catch (err) {
      if (request.current !== ticket) return
      setView({ status: 'error', title: 'Request failed', message: errorMessage(err), retry: true })
    }
  }

  function inspectRaw(source: string) {
    const parsed = parseTraceJson(source)
    if (!parsed.ok) {
      setView({ status: 'error', title: 'Cannot read that trace', message: parsed.error, retry: false })
      return
    }
    void submit(parsed.trace)
  }

  function pickDemo(demo: DemoTrace, demoIndex: number) {
    setSelected(demoIndex)
    const pretty = JSON.stringify(demo, null, 2)
    setRaw(pretty)
    inspectRaw(pretty)
  }

  function onTraceKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      inspectRaw(raw)
    }
  }

  const routeError = routeId === 'invalid' ? 'That trace id in the URL is not a whole number.' : null
  const chips = submittedSteps ? flowChips(submittedSteps) : []
  let maxSoFar = 0
  for (let cursor = 0; cursor <= position && cursor < steps.length; cursor += 1) {
    const risk = steps[cursor]?.risk
    if (typeof risk === 'number' && Number.isFinite(risk) && risk > maxSoFar) maxSoFar = risk
  }

  const loader = (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
      <Panel
        title="Demo traces"
        action={
          demos.error ? (
            <button type="button" onClick={demos.reload} className="text-xs font-medium text-fg underline">
              Retry
            </button>
          ) : null
        }
      >
        <p className="mb-3 text-xs text-muted">Choosing a demo fills the editor and runs the inspection.</p>
        {demos.loading && !demos.data ? <LoadingState label="Loading demo traces…" /> : null}
        {demos.error && !demos.data ? <ErrorState message={demos.error} onRetry={demos.reload} /> : null}
        {demos.data && demos.data.length === 0 ? (
          <EmptyState title="No demo traces" body="The demo trace file is missing or empty on the server." />
        ) : null}
        {demos.data && demos.data.length > 0 ? (
          <ul className="max-h-80 space-y-2 overflow-auto pr-1">
            {demos.data.map((demo, demoIndex) => (
              <li key={`${demo.trace_id}-${demoIndex}`}>
                <button
                  type="button"
                  aria-pressed={selected === demoIndex}
                  onClick={() => pickDemo(demo, demoIndex)}
                  className={`w-full border px-3 py-2 text-left ${
                    selected === demoIndex ? 'border-fg bg-ink' : 'border-line hover:border-fg'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{demo.title ?? demo.trace_id}</span>
                    <span className="shrink-0 border border-line px-2 py-0.5 text-[11px] text-muted">{demo.label}</span>
                  </span>
                  <span className="mt-1 block text-xs text-muted">
                    {demo.steps.length} steps{demo.title ? ` · ${demo.trace_id}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          inspectRaw(raw)
        }}
      >
        <Panel title="Trace JSON">
          <label htmlFor="trace-json" className="mb-2 block text-xs text-muted">
            Paste a trace object, or the POST body with a trace field. A demo label is ignored on submit.
          </label>
          <TextArea
            id="trace-json"
            rows={view.status === 'ready' ? 8 : 14}
            value={raw}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            placeholder='{"trace_id":"…","steps":[{"tool":"search","args":{},"result":"…"}]}'
            aria-invalid={view.status === 'error' && view.title === 'Cannot read that trace'}
            onChange={(event) => setRaw(event.target.value)}
            onKeyDown={onTraceKeyDown}
          />
          <p className="mt-2 font-mono text-[11px] text-muted">
            {'{ "trace_id": string, "steps": [{ "tool", "args", "result" }] }'}
          </p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Ctrl+Enter inspects.</p>
            <Button type="submit" disabled={view.status === 'loading'}>
              Inspect trace
            </Button>
          </div>
        </Panel>
      </form>
    </div>
  )

  return (
    <div className="flex flex-col gap-6">
      <div className={view.status === 'ready' ? 'order-2' : 'order-1'}>{loader}</div>
      <section className={`space-y-4 ${view.status === 'ready' ? 'order-1' : 'order-2'}`} aria-live="polite">
        {routeError ? <ErrorState title="Cannot open that trace" message={routeError} /> : null}
        {demoKey && view.status === 'idle' ? <LoadingState label="Opening demo case…" /> : null}
        {view.status === 'loading' ? <LoadingState label="Inspecting trace…" /> : null}
        {view.status === 'error' ? (
          <ErrorState
            title={view.title}
            message={view.message}
            onRetry={
              view.retry
                ? () => {
                    const draft = lastDraft.current
                    if (draft) void submit(draft)
                  }
                : undefined
            }
          />
        ) : null}
        {view.status === 'idle' && !routeError && !demoKey ? (
          <EmptyState title="No trace open" body="Pick a demo trace or paste JSON, then play it." />
        ) : null}
        {view.status === 'ready' && current ? (
          <Theater
            trace={view.trace}
            source={view.source}
            current={current}
            position={position}
            steps={steps}
            submittedHere={submittedHere}
            chips={chips}
            playing={playing}
            speed={speed}
            pulseKey={pulseKey}
            maxSoFar={maxSoFar}
            held={held}
            hasSubmission={view.submitted !== null}
            onPlayPause={onPlayPause}
            onJump={jump}
            onSpeed={setSpeed}
          />
        ) : null}
        {view.status === 'ready' && steps.length === 0 ? (
          <EmptyState title="No steps in this result" body="The stored analysis did not include a step list." />
        ) : null}
      </section>
    </div>
  )
}

function Theater({
  trace,
  source,
  current,
  position,
  steps,
  submittedHere,
  chips,
  playing,
  speed,
  pulseKey,
  maxSoFar,
  held,
  hasSubmission,
  onPlayPause,
  onJump,
  onSpeed,
}: {
  trace: Trace
  source: 'new' | 'stored'
  current: TraceStepResult
  position: number
  steps: TraceStepResult[]
  submittedHere: TraceStepInput | null
  chips: FlowChip[]
  playing: boolean
  speed: 1 | 2
  pulseKey: number
  maxSoFar: number
  held: boolean
  hasSubmission: boolean
  onPlayPause: () => void
  onJump: (position: number) => void
  onSpeed: (speed: 1 | 2) => void
}) {
  const stepSignals = current.signals ?? []
  const sourceSignals = stepSignals.length > 0 ? stepSignals : (trace.signals ?? [])
  const match = isIncident(current.risk) ? matchSignal(sourceSignals) : null
  const focus = match?.signal ?? (isIncident(current.risk) ? sourceSignals[0] : undefined)
  const carriers = focus
    ? steps.flatMap((step, stepPosition) =>
        (step.signals ?? []).includes(focus) ? [{ position: stepPosition, step }] : [],
      )
    : []
  const result = submittedHere ? excerpt(submittedHere.result) : null
  const meter = Math.min(100, Math.max(0, maxSoFar * 100))
  const incident = isIncident(current.risk)

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-4 border border-line bg-card px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Now showing</p>
          <h2 className="truncate font-mono text-sm">{trace.trace_id}</h2>
          <p className="mt-1 font-mono text-[11px] text-muted">
            #{trace.id} · {formatWhen(trace.created_at)}
            {source === 'stored' ? ' · stored analysis' : ' · just inspected'}
          </p>
          <div className="mt-2">
            <CategoryChips categories={trace.categories ?? []} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ScoreGauge score={trace.score} flagged={trace.flagged} size="sm" />
          <VerdictBadge flagged={trace.flagged} />
        </div>
      </header>

      <DataRibbon chips={chips} position={position} hasArgs={hasSubmission} onJump={onJump} />

      <div className="flex flex-col gap-3 sm:flex-row">
        <ol className="flex gap-2 overflow-x-auto sm:w-40 sm:shrink-0 sm:flex-col sm:overflow-visible" aria-label="Steps">
          {steps.map((step, stepPosition) => {
            const seen = stepPosition <= position
            const active = stepPosition === position
            return (
              <li key={`${step.index}-${stepPosition}`} className={stepPosition < position ? 'sm:scale-[0.98]' : undefined}>
                <button
                  type="button"
                  aria-current={active ? 'step' : undefined}
                  onClick={() => onJump(stepPosition)}
                  className={`flex w-full items-center gap-2 border px-2 py-1.5 text-left ${
                    active ? 'border-fg bg-card' : 'border-line'
                  } ${seen ? '' : 'opacity-35'}`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: seen ? riskSwatch(step.risk) : 'var(--line)' }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block font-mono text-[10px] text-muted">{step.index}</span>
                    <span className={`block truncate ${stepPosition < position ? 'text-xs' : 'text-sm'}`}>{step.tool}</span>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>

        <div
          className={`relative min-h-72 min-w-0 flex-1 border bg-ink px-4 py-4 sm:px-6 ${
            incident ? 'border-danger' : 'border-line'
          }`}
        >
          {pulseKey > 0 ? <span key={pulseKey} className="stage-pulse pointer-events-none absolute inset-0" aria-hidden="true" /> : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-muted">
                Frame {position + 1} / {steps.length} · index {current.index}
              </p>
              <h3 className="mt-1 text-3xl font-semibold tracking-tight">{current.tool}</h3>
            </div>
            <p className="font-mono text-sm tabular-nums" style={{ color: riskSwatch(current.risk) }}>
              {formatScore(current.risk)}
            </p>
          </div>

          {submittedHere ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Arguments</h4>
                <pre className="mt-2 max-h-52 overflow-auto border border-line bg-card p-3 font-mono text-[11px] leading-relaxed text-fg">
                  {JSON.stringify(submittedHere.args, null, 2)}
                </pre>
              </div>
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Result</h4>
                <pre className="mt-2 max-h-52 overflow-auto border border-line bg-card p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg">
                  {result?.text}
                </pre>
                {result?.truncated ? <p className="mt-1 text-[11px] text-muted">Result excerpt. The full string was longer.</p> : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 max-w-xl text-sm text-muted">
              This case was opened from storage. The API keeps the analysis, not the arguments, so the stage shows the
              tool, the risk, and the signals. Paste the trace again to see arguments, the result, and the data-flow
              ribbon.
            </p>
          )}

          <div className="mt-4">
            {stepSignals.length === 0 ? (
              <p className="text-xs text-muted">No step signals.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {stepSignals.map((signal, signalIndex) => (
                  <li key={`${signal}-${signalIndex}`} className="border border-line px-2 py-0.5 font-mono text-[11px]">
                    {signal}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {incident ? (
            <div className="danger-soft mt-4 border px-4 py-3" role="status">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em]">Incident</p>
              <p className="mt-2 text-base leading-snug">
                {match?.incident ??
                  (sourceSignals.length > 0
                    ? `Flagged by ${sourceSignals.length} signal${sourceSignals.length === 1 ? '' : 's'}`
                    : `Step risk ${formatScore(current.risk)}.`)}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <VerdictBadge flagged={trace.flagged} />
                <span className="font-mono text-sm tabular-nums text-fg">{formatScore(trace.score)}</span>
                {focus ? <span className="font-mono text-[11px] text-fg">{focus}</span> : null}
              </div>
              {carriers.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {carriers.map((carrier) => (
                    <button
                      key={`${carrier.step.index}-${carrier.position}`}
                      type="button"
                      onClick={() => onJump(carrier.position)}
                      className="border border-danger bg-ink px-2 py-1 text-xs text-fg"
                    >
                      Step {carrier.step.index} · {carrier.step.tool}
                    </button>
                  ))}
                </div>
              ) : null}
              {held ? (
                <p className="mt-3 text-xs text-fg">Playback paused on the first step at or above 0.5.</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="space-y-3 border border-line bg-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => onJump(position - 1)} disabled={position <= 0} aria-label="Previous step">
            Back
          </Button>
          <Button onClick={onPlayPause} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => onJump(position + 1)}
            disabled={position >= steps.length - 1}
            aria-label="Next step"
          >
            Forward
          </Button>
          <label className="sr-only" htmlFor="trace-scrubber">
            Trace position
          </label>
          <input
            id="trace-scrubber"
            type="range"
            min={0}
            max={Math.max(0, steps.length - 1)}
            value={position}
            aria-valuetext={`Step ${current.index} of ${steps.length}, ${current.tool}`}
            onChange={(event) => onJump(Number(event.target.value))}
            className="min-w-32 flex-1"
          />
          <div className="flex border border-line" role="group" aria-label="Playback speed">
            {([1, 2] as const).map((rate) => (
              <button
                key={rate}
                type="button"
                aria-pressed={speed === rate}
                onClick={() => onSpeed(rate)}
                className={`px-2 py-1 font-mono text-xs ${speed === rate ? 'bg-fg text-ink' : 'text-muted'}`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-muted">
            <span>Risk so far</span>
            <span className="font-mono normal-case">{formatScore(maxSoFar)}</span>
          </div>
          <div
            className="mt-1 h-1.5 bg-line"
            role="meter"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={Number.isFinite(maxSoFar) ? maxSoFar : 0}
            aria-label="Maximum risk played so far"
          >
            <div className={`h-full ${maxSoFar >= 0.5 ? 'bg-danger' : 'bg-fg'}`} style={{ width: `${meter}%` }} />
          </div>
        </div>
        <p className="text-[11px] text-muted">
          One step every {speed === 1 ? PLAYBACK_MS : PLAYBACK_MS / 2} ms. Space plays or pauses. Arrow keys step.
        </p>
      </div>

      {(trace.signals ?? []).length > 0 ? (
        <p className="font-mono text-[11px] break-words text-muted">Trace signals · {(trace.signals ?? []).join(' · ')}</p>
      ) : (
        <p className="text-xs text-muted">No trace signals.</p>
      )}
    </div>
  )
}

function DataRibbon({
  chips,
  position,
  hasArgs,
  onJump,
}: {
  chips: FlowChip[]
  position: number
  hasArgs: boolean
  onJump: (position: number) => void
}) {
  return (
    <div className="border border-line bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Data flow</p>
      {!hasArgs ? (
        <p className="mt-2 text-sm text-muted">
          The ribbon needs the submitted arguments. Stored analyses keep the tool, the risk, and the signals.
        </p>
      ) : null}
      {hasArgs && chips.length === 0 ? (
        <p className="mt-2 text-sm text-muted">No file paths, hosts, shell commands, or queries in these arguments.</p>
      ) : null}
      {chips.length > 0 ? (
        <ol className="mt-2 flex items-center gap-2 overflow-x-auto pb-1">
          {chips.map((chip, chipIndex) => (
            <li key={`${chip.step}-${chip.kind}-${chipIndex}`} className="flex items-center gap-2">
              {chipIndex > 0 ? (
                <span className="text-muted" aria-hidden="true">
                  →
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onJump(chip.step)}
                className={`shrink-0 border border-line px-2 py-1 text-left ${chip.step > position ? 'opacity-30' : ''}`}
              >
                <span className="block text-[10px] uppercase tracking-wide text-muted">{flowKindLabel(chip.kind)}</span>
                <span className="block font-mono text-xs whitespace-nowrap">{chip.text}</span>
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
