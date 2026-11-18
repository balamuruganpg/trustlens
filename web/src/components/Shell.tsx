import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { getHealth } from '../api'
import { useAsync } from '../lib/useAsync'
import { useTheme, type Theme } from '../lib/theme'
import { ErrorBoundary } from './ui'

const NAV = [
  {
    to: '/',
    label: 'Case Files',
    end: true,
    lede: 'A docket of scans and traces. Open one, or inspect something new.',
  },
  {
    to: '/traces',
    label: 'Replay Theater',
    end: false,
    lede: 'Play the trace and stop on the step that gets caught.',
  },
  {
    to: '/scan',
    label: 'Dissection',
    end: false,
    lede: 'The original wording, marked where the risk actually sits.',
  },
  {
    to: '/compare',
    label: 'Compare',
    end: false,
    lede: 'Paired bootstrap interval and McNemar test on two score lists.',
  },
  {
    to: '/evasion',
    label: 'Evasion Lab',
    end: false,
    lede: 'See how PromptWarden reads a prompt after five mutations.',
  },
] as const

function pageFor(pathname: string) {
  return NAV.find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to))) ?? NAV[0]
}

function LensMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0 text-fg" aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="var(--card)" stroke="var(--line)" />
      <circle cx="16" cy="16" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="16" r="2" fill="currentColor" />
      <path
        d="M16 6.5v2.4M16 23.1v2.4M6.5 16h2.4M23.1 16h2.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

function EngineRow({ name, ready }: { name: string; ready: boolean | null }) {
  const label = ready == null ? 'unknown' : ready ? 'ready' : 'unavailable'
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-muted">{name}</span>
      <span className="inline-flex items-center gap-1.5 text-fg">
        <span
          className={`h-1.5 w-1.5 rounded-full ${ready ? 'bg-fg' : 'border border-muted bg-transparent'}`}
          aria-hidden="true"
        />
        {label}
      </span>
    </div>
  )
}

function ThemeSwitch() {
  const { theme, setTheme } = useTheme()
  const options: { id: Theme; label: string }[] = [
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
  ]
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Theme</div>
      <div className="mt-2 grid grid-cols-2 gap-1" role="group" aria-label="Color theme">
        {options.map((option) => {
          const active = theme === option.id
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={active}
              onClick={() => setTheme(option.id)}
              className={`rounded-md px-2 py-1.5 text-xs font-medium ${
                active ? 'bg-fg text-ink' : 'text-muted hover:bg-card hover:text-fg'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Shell() {
  const { pathname } = useLocation()
  const page = pageFor(pathname)
  const health = useAsync(getHealth)

  useEffect(() => {
    document.title = `${page.label} · TrustLens`
  }, [page.label])

  const engines = health.data?.engines

  return (
    <div className="min-h-screen bg-ink text-fg lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <aside className="border-b border-line bg-panel lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:overflow-y-auto lg:border-r lg:border-b-0">
        <div className="px-4 py-4">
          <NavLink to="/" className="flex items-center gap-3 rounded-lg">
            <LensMark />
            <span>
              <span className="block text-[15px] leading-tight font-semibold tracking-tight">TrustLens</span>
              <span className="block text-[11px] leading-tight text-muted">Inspection Theater</span>
            </span>
          </NavLink>
        </div>
        <nav className="grid grid-cols-2 gap-1 px-3 pb-3 lg:flex lg:flex-col" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-left text-sm ${
                  isActive ? 'bg-fg text-ink' : 'text-muted hover:bg-card hover:text-fg'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="space-y-2 border-t border-line px-4 py-4 lg:mt-auto">
          <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">Engines</div>
          {health.loading && !health.data ? <p className="text-xs text-muted">Checking engines…</p> : null}
          {health.error ? <p className="text-xs break-words text-danger">{health.error}</p> : null}
          {health.data ? (
            <>
              <EngineRow name="PromptWarden" ready={engines ? engines.promptwarden : null} />
              <EngineRow name="AgentSentinel" ready={engines ? engines.agentsentinel : null} />
              {!health.data.ok ? <p className="text-xs text-fg">Service reported not ok.</p> : null}
            </>
          ) : null}
          {health.error ? (
            <button type="button" onClick={health.reload} className="text-xs font-medium text-fg underline">
              Retry
            </button>
          ) : null}
          <ThemeSwitch />
        </div>
      </aside>
      <div className="min-w-0">
        <header className="border-b border-line px-5 py-4 sm:px-8">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted">TrustLens</p>
          <h1 className="text-lg font-semibold tracking-tight">{page.label}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{page.lede}</p>
        </header>
        <main id="content" className="px-5 py-6 sm:px-8">
          <div className="mx-auto max-w-6xl">
            <ErrorBoundary key={pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  )
}
