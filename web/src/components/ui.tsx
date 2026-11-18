import { Component, type ButtonHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
}

export function Button({ variant = 'primary', className = '', type = 'button', ...props }: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'bg-accent text-ink hover:opacity-90'
      : 'border border-line bg-transparent text-fg hover:bg-card'
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${variantClass} ${className}`}
      {...props}
    />
  )
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export function TextArea({ className = '', ...props }: TextAreaProps) {
  return (
    <textarea
      className={`w-full resize-y rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm leading-relaxed text-fg placeholder:text-muted ${className}`}
      {...props}
    />
  )
}

export function Panel({
  title,
  action,
  children,
  className = '',
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-line bg-card ${className}`}>
      {title ? (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          {action}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </section>
  )
}

export function Stat({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string
  value: string
  hint?: string
  tone?: 'default' | 'danger'
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : 'text-fg'
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl tabular-nums ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted">{hint}</div> : null}
    </div>
  )
}

export function LoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="rounded-xl border border-line bg-card px-4 py-4">
      <p className="text-sm text-muted">{label}</p>
      <div className="mt-3 space-y-2" aria-hidden="true">
        <div className="h-3 w-1/3 animate-pulse rounded bg-fg/10" />
        <div className="h-16 animate-pulse rounded bg-fg/5" />
      </div>
    </div>
  )
}

export function ErrorState({
  title = 'Request failed',
  message,
  onRetry,
}: {
  title?: string
  message: string
  onRetry?: () => void
}) {
  return (
    <div role="alert" className="danger-soft rounded-xl border px-4 py-3">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-fg">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="mt-3 text-sm font-medium text-fg underline underline-offset-2">
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted">{body}</p>
    </div>
  )
}

export function VerdictBadge({ flagged }: { flagged: boolean }) {
  if (flagged) {
    return (
      <span className="danger-soft inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide">
        Flagged
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full border border-line px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">
      Clean
    </span>
  )
}

export function GateBadge({ gate }: { gate: string }) {
  const fail = gate === 'FAIL'
  const tone = fail ? 'danger-soft' : 'border-line text-fg'
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium ${tone}`}>
      {gate}
    </span>
  )
}

export function CategoryChips({ categories }: { categories: string[] }) {
  if (categories.length === 0) {
    return <p className="text-sm text-muted">No categories.</p>
  }
  return (
    <ul className="flex flex-wrap gap-2">
      {categories.map((category, index) => (
        <li key={`${category}-${index}`} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-fg">
          {category}
        </li>
      ))}
    </ul>
  )
}

export function SignalList({ signals }: { signals: string[] }) {
  if (signals.length === 0) {
    return <p className="text-sm text-muted">No signals.</p>
  }
  return (
    <ul className="space-y-1.5">
      {signals.map((signal, index) => (
        <li
          key={`${signal}-${index}`}
          className="rounded-md border border-line bg-ink px-3 py-2 font-mono text-xs leading-relaxed break-words text-fg"
        >
          {signal}
        </li>
      ))}
    </ul>
  )
}

type BoundaryProps = { children: ReactNode }
type BoundaryState = { error: string | null }

export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error: error instanceof Error ? error.message : 'This view crashed.' }
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="This view hit an error"
          message={this.state.error}
          onRetry={() => {
            this.setState({ error: null })
          }}
        />
      )
    }
    return this.props.children
  }
}
