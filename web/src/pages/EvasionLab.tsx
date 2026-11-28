import { Fragment, useState, type FormEvent } from 'react'
import {
  getDemoPrompts,
  getEvasionLedger,
  postSpecimens,
  type DemoPrompt,
  type EvasionLedger,
  type SpecimenScan,
} from '../api'
import { Button, EmptyState, ErrorState, LoadingState, TextArea } from '../components/ui'
import { formatCount, formatScore, previewText } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const OPERATOR_GLOSS: Record<string, string> = {
  leet: 'Replaces letters with digits',
  space_out: 'Spaces out longer words',
  homoglyph: 'Substitutes look-alike letters',
  char_reverse: 'Reverses each word',
  zero_width: 'Inserts zero-width spaces',
}

function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${(rate * 100).toFixed(2)}%`
}

function SpecimenText({ scan, operator, original }: {
  scan: SpecimenScan
  operator?: string
  original?: string
}) {
  let text = <>{scan.text}</>
  if (operator === 'zero_width') {
    text = (
      <>
        {scan.text.split('\u200b').map((part, index) => (
          <Fragment key={index}>
            {index > 0 ? (
              <span
                aria-hidden="true"
                title="U+200B zero-width space"
                className="mx-px inline-block border-b border-muted px-0.5 align-baseline font-sans text-[9px] text-muted before:content-['ZW']"
              >
                {'\u200b'}
              </span>
            ) : null}
            {part}
          </Fragment>
        ))}
      </>
    )
  } else if (operator === 'homoglyph' && original !== undefined) {
    const originals = Array.from(original)
    text = <>{Array.from(scan.text).map((char, index) => (
      char === originals[index] ? char : (
        <span key={index} className="underline decoration-dotted underline-offset-4">
          {char}
        </span>
      )
    ))}</>
  }
  return <p dir="auto" className="font-mono text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
}

function SpecimenCard({ scan, operator, original, slipped = false }: {
  scan: SpecimenScan
  operator?: string
  original?: string
  slipped?: boolean
}) {
  const stamp = slipped ? 'Slipped past' : scan.flagged ? 'Caught' : 'Clear'
  const stampTone = slipped ? 'border-danger bg-ink text-danger' : 'border-line text-muted'
  return (
    <article className="h-full min-w-0 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-mono text-sm font-medium [overflow-wrap:anywhere]">{operator ?? 'Original'}</h3>
        <span className={`relative inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${stampTone}`}>
          {slipped ? <span className="stage-pulse pointer-events-none absolute inset-0 rounded-full" aria-hidden="true" /> : null}
          {stamp}
        </span>
      </div>
      {operator ? <p className="mt-1 text-xs text-muted">{OPERATOR_GLOSS[operator]}</p> : null}
      <div className="my-3 border-y border-line py-3">
        <SpecimenText scan={scan} operator={operator} original={original} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted">
        <p>Score <strong className="font-mono font-medium tabular-nums text-fg">{formatScore(scan.score)}</strong></p>
        {scan.categories.length > 0 ? <p>{scan.categories.join(' · ')}</p> : null}
      </div>
      {scan.signals.length > 0 ? (
        <details className="mt-2 text-xs text-muted">
          <summary>Scan signals</summary>
          <ul className="mt-2 space-y-1 font-mono [overflow-wrap:anywhere]">
            {scan.signals.map((signal, index) => <li key={`${signal}-${index}`}>{signal}</li>)}
          </ul>
        </details>
      ) : null}
    </article>
  )
}

function SpecimenBench({ text }: { text: string }) {
  const { data, error, loading, reload } = useAsync(() => postSpecimens(text))
  if (error) return <ErrorState title="The bench could not scan" message={error} onRetry={reload} />
  if (loading || !data) return <LoadingState label="Scanning the original and its variants…" />
  const slipped = data.variants.filter((variant) => variant.slipped).length

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <section aria-label="Before" className="space-y-2 xl:sticky xl:top-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Before</p>
        <SpecimenCard scan={data.original} />
      </section>
      <section aria-label="After" className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">After</p>
          <p role="status" className="font-mono text-xs text-muted">
            {formatCount(slipped)} of {formatCount(data.variants.length)} slipped past
          </p>
        </div>
        <ul className="grid gap-3 md:grid-cols-2">
          {data.variants.map((variant) => (
            <li key={variant.operator} className="min-w-0">
              <SpecimenCard scan={variant} operator={variant.operator} original={data.original.text} slipped={variant.slipped} />
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">Dotted underlines mark look-alike substitutions. ZW marks a zero-width space.</p>
      </section>
    </div>
  )
}

function SpecimenPicker({ prompts, selectedText, onSelect }: {
  prompts: DemoPrompt[]
  selectedText: string | undefined
  onSelect: (text: string) => void
}) {
  return (
    <details className="rounded-xl border border-line bg-card">
      <summary className="px-4 py-3 text-sm font-medium">Choose a demo prompt</summary>
      <ul className="grid gap-px border-t border-line bg-line md:grid-cols-2">
        {prompts.map((prompt, index) => (
          <li key={index} className="min-w-0 bg-card">
            <button
              type="button"
              aria-pressed={prompt.text === selectedText}
              className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-panel aria-pressed:bg-fg aria-pressed:text-ink aria-pressed:hover:opacity-90"
              onClick={(event) => {
                const picker = event.currentTarget.closest('details')
                if (picker) {
                  picker.open = false
                  picker.querySelector('summary')?.focus()
                }
                onSelect(prompt.text)
              }}
            >
              <span className="w-16 shrink-0 font-mono text-[11px] uppercase">{prompt.category ?? 'prompt'}</span>
              <span className="truncate text-sm" title={prompt.text}>{previewText(prompt.text)}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function CustomSpecimen({ onSelect }: { onSelect: (text: string) => void }) {
  const [draft, setDraft] = useState('')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.trim()) return
    const drawer = event.currentTarget.closest('details')
    if (drawer) {
      drawer.open = false
      drawer.querySelector('summary')?.focus()
    }
    onSelect(draft)
  }

  return (
    <details className="rounded-xl border border-line bg-card">
      <summary className="px-4 py-3 text-sm font-medium">Scan your own prompt</summary>
      <form onSubmit={submit} className="space-y-3 border-t border-line p-4">
        <label htmlFor="specimen-text" className="block text-sm text-muted">Prompt text</label>
        <TextArea id="specimen-text" rows={4} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Button type="submit" disabled={!draft.trim()}>Scan specimens</Button>
      </form>
    </details>
  )
}

function Ledger({ data }: { data: EvasionLedger }) {
  const totals = [
    { label: 'Originals flagged', value: data.originals_flagged, note: `of ${formatCount(data.prompts)} demo prompts` },
    { label: 'Variants generated', value: data.variants_generated, note: `${formatCount(data.variants_from_flagged)} from flagged originals` },
    { label: 'Bypassed', value: data.bypassed, note: 'variants of flagged originals that scanned clear' },
  ]
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-card">
      <dl className="grid gap-px border-b border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {totals.map(({ label, value, note }) => (
          <div key={label} className="bg-card p-4">
            <dt className="text-xs font-medium">{label}</dt>
            <dd className="mt-1 font-mono text-xl tabular-nums">{formatCount(value)}</dd>
            <dd className="mt-1 text-xs text-muted">{note}</dd>
          </div>
        ))}
        <div className="bg-card p-4">
          <dt className="text-xs font-medium">Bypass rate</dt>
          <dd className="mt-1 font-mono text-xl tabular-nums">{formatRate(data.bypass_rate)}</dd>
          <dd className="mt-1 text-xs text-muted">
            {data.bypass_rate === null ? 'No flagged originals' : 'Of variants from flagged originals'}
          </dd>
        </div>
      </dl>
      <table className="w-full text-left text-xs">
        <caption className="sr-only">Demo-set bypasses by operator</caption>
        <thead className="border-b border-line text-muted">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium sm:px-4">Operator</th>
            <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4">Bypassed / eligible</th>
            <th scope="col" className="px-3 py-2 text-right font-medium sm:px-4">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono tabular-nums">
          {data.operators.map((row) => (
            <tr key={row.operator}>
              <th scope="row" className="px-3 py-2 font-normal sm:px-4">{row.operator}</th>
              <td className="px-3 py-2 text-right sm:px-4">{formatCount(row.bypassed)} / {formatCount(row.variants)}</td>
              <td className="px-3 py-2 text-right sm:px-4">{formatRate(row.bypass_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function EvasionLabPage() {
  const ledger = useAsync(getEvasionLedger)
  const demos = useAsync(getDemoPrompts)
  const [selection, setSelection] = useState<{ text: string; revision: number } | null>(null)
  const prompts = demos.data?.filter((prompt) => prompt.label === 'malicious') ?? []
  const selectedText = selection?.text ?? prompts[0]?.text

  function select(text: string) {
    setSelection((previous) => ({ text, revision: (previous?.revision ?? 0) + 1 }))
  }

  return (
    <div className="space-y-8">
      <section aria-labelledby="specimen-tray" className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="specimen-tray" className="text-xl font-semibold tracking-tight">Specimen tray</h2>
          <a href="#robustness-ledger" className="text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
            Robustness ledger ↓
          </a>
        </div>
        {demos.error ? <ErrorState title="Demo prompts unavailable" message={demos.error} onRetry={demos.reload} /> : null}
        {prompts.length > 0 ? <SpecimenPicker prompts={prompts} selectedText={selectedText} onSelect={select} /> : null}
        <CustomSpecimen onSelect={select} />
        {selectedText ? <SpecimenBench key={selection?.revision ?? 0} text={selectedText} /> : null}
        {!selectedText && demos.loading ? <LoadingState label="Opening the specimen tray…" /> : null}
        {!selectedText && demos.data ? (
          <EmptyState title="The tray is empty" body="Scan your own prompt to open a specimen." />
        ) : null}
      </section>
      <section id="robustness-ledger" aria-labelledby="ledger-title" className="space-y-3">
        <div>
          <h2 id="ledger-title" className="text-xl font-semibold tracking-tight">Robustness ledger</h2>
          <p className="mt-1 text-sm text-muted">Live PromptWarden results for the shipped demo set.</p>
        </div>
        {ledger.loading && !ledger.data ? <LoadingState label="Reading the robustness ledger…" /> : null}
        {ledger.error ? <ErrorState message={ledger.error} onRetry={ledger.reload} /> : null}
        {ledger.data ? <Ledger data={ledger.data} /> : null}
      </section>
    </div>
  )
}
