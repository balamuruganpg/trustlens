import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { errorMessage, getDemoPrompts, getScan, getScans, postScan, type Scan } from '../api'
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
import { clauseHeat, scoredClauseCount, splitClauses, type ClauseSlice } from '../lib/clauses'
import { formatScore, formatWhen, parseRouteId, previewText } from '../lib/format'
import { recallPrompt, rememberPrompt } from '../lib/promptMemory'
import { caseStory, explainSignal } from '../lib/stories'
import { useAsync } from '../lib/useAsync'

type ClauseScore =
  | { kind: 'skip' }
  | { kind: 'pending' }
  | { kind: 'scored'; score: number; flagged: boolean; signals: string[]; categories: string[] }
  | { kind: 'failed'; message: string }

type ScanView =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; title: string; message: string }
  | {
      status: 'ready'
      scan: Scan
      source: 'new' | 'stored'
      text: string | null
      slices: ClauseSlice[]
      scores: ClauseScore[]
      scoring: boolean
    }

const demoFlights = new Map<string, Promise<Scan>>()

function fromScan(scan: Scan): ClauseScore {
  return {
    kind: 'scored',
    score: scan.score,
    flagged: scan.flagged,
    signals: scan.signals ?? [],
    categories: scan.categories ?? [],
  }
}

function hottest(scores: ClauseScore[]): number | null {
  let best = -1
  let bestScore = -1
  scores.forEach((score, index) => {
    if (score.kind !== 'scored') return
    if (score.score > bestScore) {
      bestScore = score.score
      best = index
    }
  })
  return best >= 0 ? best : null
}

function sliceCore(slice: ClauseSlice): { leading: string; core: string; trailing: string } {
  const leading = /^\s*/.exec(slice.text)?.[0] ?? ''
  const trailing = /\s*$/.exec(slice.text)?.[0] ?? ''
  const core = slice.text.slice(leading.length, slice.text.length - trailing.length)
  return { leading, core, trailing }
}

export function PromptScanPage() {
  const demos = useAsync(getDemoPrompts)
  const history = useAsync(() => getScans(50))
  const reloadHistory = history.reload
  const [params, setParams] = useSearchParams()
  const routeId = parseRouteId(params.get('id'))
  const demoKey = params.get('demo')
  const [draft, setDraft] = useState('')
  const [view, setView] = useState<ScanView>({ status: 'idle' })
  const [pinned, setPinned] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const request = useRef(0)
  const shownId = useRef<number | null>(null)
  const userPicked = useRef(false)

  const scoreClauses = useCallback((scan: Scan, prompt: string, source: 'new' | 'stored', ticket: number) => {
    const slices = splitClauses(prompt)
    const count = scoredClauseCount(slices)
    if (count <= 1) {
      const scores = slices.map((slice) => (slice.scanText ? fromScan(scan) : { kind: 'skip' as const }))
      setPinned(hottest(scores))
      setView({ status: 'ready', scan, source, text: prompt, slices, scores, scoring: false })
      return
    }
    const pending = slices.map((slice) => (slice.scanText ? { kind: 'pending' as const } : { kind: 'skip' as const }))
    setView({ status: 'ready', scan, source, text: prompt, slices, scores: pending, scoring: true })
    void Promise.allSettled(
      slices.map((slice) => (slice.scanText ? postScan(slice.scanText, scan.id) : Promise.resolve(null))),
    ).then(
      (settled) => {
        if (request.current !== ticket) return
        const scores: ClauseScore[] = settled.map((result, index) => {
          const slice = slices[index]
          if (!slice?.scanText) return { kind: 'skip' }
          if (result.status === 'rejected') return { kind: 'failed', message: errorMessage(result.reason) }
          const clause = result.value
          if (!clause) return { kind: 'failed', message: 'The clause scan returned an empty response.' }
          return fromScan(clause)
        })
        setPinned((current) => (userPicked.current ? current : hottest(scores)))
        setView({ status: 'ready', scan, source, text: prompt, slices, scores, scoring: false })
        reloadHistory()
      },
    )
  }, [reloadHistory])

  const loadStored = useCallback(
    (id: number) => {
      const ticket = ++request.current
      userPicked.current = false
      setHover(null)
      setPinned(null)
      setView({ status: 'loading' })
      getScan(id)
        .then((scan) => {
          if (request.current !== ticket) return
          shownId.current = scan.id
          const storedText = typeof scan.text === 'string' ? scan.text : ''
          const prompt = storedText.trim() ? storedText : recallPrompt(id)
          if (!prompt) {
            setView({ status: 'ready', scan, source: 'stored', text: null, slices: [], scores: [], scoring: false })
            return
          }
          setDraft(prompt)
          scoreClauses(scan, prompt, 'stored', ticket)
        })
        .catch((err: unknown) => {
          if (request.current === ticket) {
            setView({ status: 'error', title: 'Request failed', message: errorMessage(err) })
          }
        })
    },
    [scoreClauses],
  )

  useEffect(() => {
    if (typeof routeId !== 'number') return
    if (shownId.current === routeId) return
    loadStored(routeId)
  }, [routeId, loadStored])

  useEffect(() => {
    if (typeof routeId === 'number' || routeId === 'invalid') return
    if (!demoKey || !demos.data) return
    if (!/^\d+$/.test(demoKey)) {
      setView({ status: 'error', title: 'Cannot open that demo', message: 'That demo id is not a whole number.' })
      return
    }
    const index = Number(demoKey)
    const prompt = demos.data[index]
    if (!prompt) {
      setView({
        status: 'error',
        title: 'Demo not found',
        message: `No demo prompt at position ${index + 1}.`,
      })
      return
    }
    const ticket = ++request.current
    userPicked.current = false
    setHover(null)
    setPinned(null)
    setDraft(prompt.text)
    setView({ status: 'loading' })
    const flightKey = `${index}:${prompt.text}`
    const existing = demoFlights.get(flightKey)
    const flight = existing ?? postScan(prompt.text)
    if (!existing) demoFlights.set(flightKey, flight)
    let cancelled = false
    flight.then(
      (scan) => {
        demoFlights.delete(flightKey)
        if (cancelled || request.current !== ticket) return
        shownId.current = scan.id
        rememberPrompt(scan.id, prompt.text)
        setParams({ id: String(scan.id) }, { replace: true })
        reloadHistory()
        scoreClauses(scan, prompt.text, 'new', ticket)
      },
      (err: unknown) => {
        demoFlights.delete(flightKey)
        if (cancelled || request.current !== ticket) return
        setView({ status: 'error', title: 'Request failed', message: errorMessage(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [demoKey, demos.data, reloadHistory, routeId, scoreClauses, setParams])

  async function onScan() {
    const prompt = draft
    if (prompt.trim() === '') {
      setView({ status: 'error', title: 'Nothing to scan', message: 'Enter a prompt to scan.' })
      return
    }
    const ticket = ++request.current
    userPicked.current = false
    setHover(null)
    setPinned(null)
    setView({ status: 'loading' })
    try {
      const scan = await postScan(prompt)
      if (request.current !== ticket) return
      shownId.current = scan.id
      rememberPrompt(scan.id, prompt)
      setParams({ id: String(scan.id) }, { replace: true })
      history.reload()
      scoreClauses(scan, prompt, 'new', ticket)
    } catch (err) {
      if (request.current !== ticket) return
      setView({ status: 'error', title: 'Request failed', message: errorMessage(err) })
    }
  }

  function onPromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void onScan()
    }
  }

  function openHistory(id: number) {
    if (routeId === id) {
      loadStored(id)
      return
    }
    setParams({ id: String(id) }, { replace: true })
  }

  const selectedId = view.status === 'ready' ? view.scan.id : null
  const routeError = routeId === 'invalid' ? 'That scan id in the URL is not a whole number.' : null
  const active = hover ?? pinned
  const activeSlice = view.status === 'ready' && active != null ? view.slices[active] : undefined
  const activeScore = view.status === 'ready' && active != null ? view.scores[active] : undefined
  const clauseCount = view.status === 'ready' ? scoredClauseCount(view.slices) : 0
  const bestScore = view.status === 'ready' ? hottest(view.scores) : null
  const best = bestScore != null && view.status === 'ready' ? view.scores[bestScore] : undefined

  return (
    <div className="space-y-6">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Demo prompts</h2>
          {demos.error ? (
            <button type="button" onClick={demos.reload} className="text-xs font-medium text-fg underline">
              Retry
            </button>
          ) : null}
        </div>
        {demos.loading && !demos.data ? <LoadingState label="Loading demo prompts…" /> : null}
        {demos.error && !demos.data ? <ErrorState message={demos.error} onRetry={demos.reload} /> : null}
        {demos.data && demos.data.length === 0 ? (
          <EmptyState title="No demo prompts" body="The demo prompt file is missing or empty on the server." />
        ) : null}
        {demos.data && demos.data.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {demos.data.map((prompt, index) => (
              <li key={`${prompt.category}-${index}`}>
                <button
                  type="button"
                  title={prompt.text}
                  onClick={() => setDraft(prompt.text)}
                  className="w-64 max-w-full rounded-lg border border-line bg-card px-3 py-2 text-left hover:border-fg"
                >
                  <span className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted">
                    <span>{prompt.category ?? 'benign'}</span>
                    <span>{prompt.label}</span>
                  </span>
                  <span className="mt-1 block truncate text-sm">{previewText(prompt.text)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          void onScan()
        }}
      >
        <Panel title="Prompt">
          <label htmlFor="prompt-text" className="mb-2 block text-xs text-muted">
            Text to dissect
          </label>
          <TextArea
            id="prompt-text"
            rows={8}
            value={draft}
            placeholder="Paste a prompt. Each clause is scored on its own so the hot sentence can stand out."
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onPromptKeyDown}
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted">Ctrl+Enter dissects.</p>
            <Button type="submit" disabled={draft.trim() === '' || view.status === 'loading'}>
              Dissect
            </Button>
          </div>
        </Panel>
      </form>

      <div aria-live="polite" className="space-y-4">
        {routeError ? <ErrorState title="Cannot open that scan" message={routeError} /> : null}
        {demoKey && view.status === 'idle' ? <LoadingState label="Opening demo case…" /> : null}
        {view.status === 'loading' ? <LoadingState label="Dissecting prompt…" /> : null}
        {view.status === 'error' ? <ErrorState title={view.title} message={view.message} /> : null}
        {view.status === 'idle' && !routeError && !demoKey ? (
          <EmptyState title="No dissection yet" body="Dissect a prompt, or open one from past dissections below." />
        ) : null}
        {view.status === 'ready' ? (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <article className="border border-line bg-card px-4 py-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Exhibit</h2>
                <p className="font-mono text-[11px] text-muted">
                  #{view.scan.id} · {formatWhen(view.scan.created_at)}
                </p>
              </div>
              {view.text == null ? (
                <p className="mt-4 text-sm text-muted">
                  This stored scan has no prompt text on file, and this browser does not have a copy, so the wording
                  cannot be marked again. The verdict on the right is the stored scan.
                </p>
              ) : (
                <>
                  {view.text !== draft ? (
                    <p className="mt-3 text-xs text-muted">The editor has changed since this dissection.</p>
                  ) : null}
                  <div className="mt-4 text-lg leading-relaxed whitespace-pre-wrap" aria-label="Annotated prompt">
                    {view.slices.map((slice, index) => {
                      const parts = sliceCore(slice)
                      const score = view.scores[index]
                      if (!slice.scanText || !parts.core) return <span key={index}>{slice.text}</span>
                      const heat = score?.kind === 'scored' ? clauseHeat(score.score, score.flagged) : null
                      const selected = active === index
                      return (
                        <span key={index}>
                          {parts.leading}
                          <button
                            type="button"
                            aria-pressed={selected}
                            className={`inline cursor-pointer text-left whitespace-pre-wrap ${
                              selected ? 'outline outline-1 outline-offset-2 outline-fg' : ''
                            }`}
                            style={heat ?? undefined}
                            onMouseEnter={() => setHover(index)}
                            onMouseLeave={() => setHover((current) => (current === index ? null : current))}
                            onFocus={() => {
                              userPicked.current = true
                              setPinned(index)
                            }}
                            onClick={() => {
                              userPicked.current = true
                              setPinned(index)
                            }}
                          >
                            {parts.core}
                          </button>
                          {parts.trailing}
                        </span>
                      )
                    })}
                  </div>
                  <p className="mt-4 text-xs text-muted">
                    {clauseCount <= 1
                      ? 'One clause, so the mark uses the whole-text scan.'
                      : `Each clause is scored under this dissection, up to 12. ${view.scoring ? 'Scoring clauses…' : 'Select a clause to read its evidence.'}`}
                  </p>
                </>
              )}
            </article>

            <aside className="space-y-4 border border-line bg-card px-4 py-4 lg:sticky lg:top-4">
              <div>
                <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">Verdict</h2>
                <div className="mt-3 flex items-center gap-3">
                  <ScoreGauge score={view.scan.score} flagged={view.scan.flagged} size="sm" />
                  <div className="space-y-2">
                    <VerdictBadge flagged={view.scan.flagged} />
                    <p className="font-mono text-xs text-muted">{formatScore(view.scan.score)} whole text</p>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Categories</h3>
                <CategoryChips categories={view.scan.categories ?? []} />
              </div>
              <div>
                <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Signals</h3>
                {(view.scan.signals ?? []).length === 0 ? (
                  <p className="text-sm text-muted">No signals.</p>
                ) : (
                  <ul className="space-y-2">
                    {(view.scan.signals ?? []).map((signal, index) => (
                      <li key={`${signal}-${index}`}>
                        <p className="font-mono text-[11px] break-words text-muted">{signal}</p>
                        <p className="text-sm leading-snug">{explainSignal(signal)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-line pt-3">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Evidence</h3>
                {view.text == null ? (
                  <p className="mt-2 text-sm text-muted">No clause evidence without the original wording.</p>
                ) : null}
                {view.text != null && !activeSlice ? (
                  <p className="mt-2 text-sm text-muted">Hover or select a clause.</p>
                ) : null}
                {activeSlice?.scanText ? (
                  <div className="mt-2 space-y-2">
                    <p className="text-sm leading-snug">“{activeSlice.scanText}”</p>
                    {activeScore?.kind === 'pending' ? <p className="text-sm text-muted">Scoring this clause…</p> : null}
                    {activeScore?.kind === 'failed' ? <p className="text-sm text-danger">{activeScore.message}</p> : null}
                    {activeScore?.kind === 'scored' ? (
                      <>
                        <p className="font-mono text-sm tabular-nums">
                          {formatScore(activeScore.score)}
                          {activeScore.flagged ? ' · flagged' : ' · clean'}
                        </p>
                        {activeScore.signals.length === 0 ? (
                          <p className="text-sm text-muted">No signals on this clause.</p>
                        ) : (
                          <ul className="space-y-2">
                            {activeScore.signals.map((signal, index) => (
                              <li key={`${signal}-${index}`}>
                                <p className="font-mono text-[11px] break-words text-muted">{signal}</p>
                                <p className="text-sm leading-snug">{explainSignal(signal)}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </>
                    ) : null}
                  </div>
                ) : null}
                {best?.kind === 'scored' && clauseCount > 1 ? (
                  <p className="mt-3 text-xs text-muted">Highest clause score {formatScore(best.score)}.</p>
                ) : null}
              </div>
            </aside>
          </div>
        ) : null}
      </div>

      <Panel
        title="Past dissections"
        action={
          <button type="button" onClick={history.reload} className="text-xs font-medium text-fg underline">
            Refresh
          </button>
        }
      >
        {history.loading && !history.data ? <LoadingState label="Loading past dissections…" /> : null}
        {history.error ? <ErrorState message={history.error} onRetry={history.reload} /> : null}
        {history.data && history.data.items.length === 0 ? (
          <EmptyState title="No scans stored" body="A dissection you run is saved and listed here, newest first." />
        ) : null}
        {history.data && history.data.items.length > 0 ? (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {history.data.items.map((scan) => {
              const selected = selectedId === scan.id
              const story = caseStory({
                kind: 'scan',
                flagged: scan.flagged,
                score: scan.score,
                signals: scan.signals ?? [],
                categories: scan.categories ?? [],
              })
              return (
                <li key={scan.id}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => openHistory(scan.id)}
                    className={`w-full border px-3 py-2 text-left ${selected ? 'border-fg bg-ink' : 'border-line hover:border-fg'}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-muted">#{scan.id}</span>
                      <VerdictBadge flagged={scan.flagged} />
                    </span>
                    <span className="mt-2 block text-sm">{story}</span>
                    <span className="mt-2 block font-mono text-lg tabular-nums">{formatScore(scan.score)}</span>
                    <span className="mt-1 block text-xs text-muted">{formatWhen(scan.created_at)}</span>
                    {scan.categories?.length ? (
                      <span className="mt-1 block truncate text-xs text-muted">{scan.categories.join(' · ')}</span>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}
      </Panel>
    </div>
  )
}
