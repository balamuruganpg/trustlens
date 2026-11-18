/**
 * Typed client for the TrustLens HTTP API (SPEC v1). All paths are same-origin
 * `/api/...`; the Vite dev server proxies them to http://localhost:8000.
 *
 * Where the SPEC leaves the JSON envelope implicit:
 * - `GET /api/demo/prompts` and `GET /api/demo/traces` are lists. Missing demo
 *   files yield empty lists, and unlike `/api/scans` the SPEC does not wrap
 *   them in `{ items }`. This client expects a JSON array.
 * - `GET /api/traces` uses the same envelopes as scans (`{ items }` for the
 *   list, one object for the detail). Each item is a stored trace result,
 *   including `steps`, matching `POST /api/traces`.
 */

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export type Scan = {
  id: number
  score: number
  flagged: boolean
  categories: string[]
  signals: string[]
  created_at: string
}

export type ScanList = {
  items: Scan[]
}

export type TraceStepInput = {
  tool: string
  args: Record<string, unknown>
  result: string
}

export type TraceInput = {
  trace_id: string
  steps: TraceStepInput[]
}

export type TraceStepResult = {
  index: number
  tool: string
  risk: number
  signals: string[]
}

export type Trace = {
  id: number
  trace_id: string
  score: number
  flagged: boolean
  categories: string[]
  signals: string[]
  steps: TraceStepResult[]
  created_at: string
}

export type TraceList = {
  items: Trace[]
}

/** SPEC gate: FAIL when the CI upper bound is below 0, otherwise PASS. */
export type CompareGate = 'PASS' | 'FAIL'

export type CompareResult = {
  n: number
  baseline_mean: number
  candidate_mean: number
  mean_diff: number
  ci_low: number
  ci_high: number
  mcnemar_p: number
  gate: CompareGate
}

export type CountSummary = {
  total: number
  flagged: number
  avg_score: number
}

export type CategoryCount = {
  category: string
  count: number
}

export type TrendPoint = {
  date: string
  scans: number
  traces: number
  flagged: number
}

export type Overview = {
  scans: CountSummary
  traces: CountSummary
  categories: CategoryCount[]
  trend: TrendPoint[]
}

export type DemoPrompt = {
  text: string
  label: string
  category: string | null
}

export type DemoTrace = TraceInput & {
  label: string
  title?: string
}

export type Health = {
  ok: boolean
  engines: {
    promptwarden: boolean
    agentsentinel: boolean
  }
}

export type SpecimenScan = {
  text: string
  score: number
  flagged: boolean
  categories: string[]
  signals: string[]
}

export type VariantSpecimen = SpecimenScan & {
  operator: string
  slipped: boolean
}

export type Specimens = {
  original: SpecimenScan
  variants: VariantSpecimen[]
}

export type OperatorLedger = {
  operator: string
  variants: number
  bypassed: number
  bypass_rate: number | null
}

export type EvasionLedger = {
  scope: 'demo-set'
  prompts: number
  originals_flagged: number
  variants_generated: number
  variants_from_flagged: number
  bypassed: number
  bypass_rate: number | null
  operators: OperatorLedger[]
}

/** SPEC comparison default. The documented interval is the 95% paired bootstrap. */
export const COMPARE_ALPHA = 0.05

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return 'Unexpected error.'
}

function formatDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return 'Request failed.'
  const detail = (body as { detail?: unknown }).detail
  if (typeof detail === 'string' && detail.trim()) return detail
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (!item || typeof item !== 'object') return String(item)
        const record = item as { loc?: unknown; msg?: unknown }
        const msg = typeof record.msg === 'string' ? record.msg : ''
        const loc = Array.isArray(record.loc)
          ? record.loc
              .filter((part) => part !== 'body')
              .map((part) => String(part))
              .join('.')
          : ''
        if (loc && msg) return `${loc}: ${msg}`
        return msg
      })
      .filter((part) => part.length > 0)
    if (parts.length > 0) return parts.join(' ')
  }
  if (detail && typeof detail === 'object') return JSON.stringify(detail)
  return 'Request failed.'
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'Cannot reach the TrustLens API. Start the server on port 8000.')
  }

  const text = await response.text()
  let body: unknown = null
  if (text) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      body = null
    }
  }

  if (!response.ok) {
    const detail = body ? formatDetail(body) : ''
    throw new ApiError(
      response.status,
      detail && detail !== 'Request failed.' ? detail : `Request failed (${response.status}).`,
    )
  }

  if (body === null) {
    throw new ApiError(response.status, 'The API returned an empty response.')
  }

  return body as T
}

function readItems<T>(body: unknown, path: string): T[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(200, `${path} did not return an object with an items list.`)
  }
  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items)) {
    throw new ApiError(200, `${path} did not return an object with an items list.`)
  }
  return items as T[]
}

function readList<T>(body: unknown, path: string): T[] {
  if (!Array.isArray(body)) {
    throw new ApiError(200, `${path} did not return a list.`)
  }
  return body as T[]
}

export function getHealth(): Promise<Health> {
  return request<Health>('/api/health')
}

export function getOverview(): Promise<Overview> {
  return request<Overview>('/api/insights/overview')
}

export async function getScans(limit = 50): Promise<ScanList> {
  const body = await request<unknown>(`/api/scans?limit=${limit}`)
  return { items: readItems<Scan>(body, 'GET /api/scans') }
}

export function getScan(id: number): Promise<Scan> {
  return request<Scan>(`/api/scans/${id}`)
}

export function postScan(text: string): Promise<Scan> {
  return request<Scan>('/api/scan', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function getTraces(limit = 50): Promise<TraceList> {
  const body = await request<unknown>(`/api/traces?limit=${limit}`)
  return { items: readItems<Trace>(body, 'GET /api/traces') }
}

export function getTrace(id: number): Promise<Trace> {
  return request<Trace>(`/api/traces/${id}`)
}

export function postTrace(trace: TraceInput): Promise<Trace> {
  return request<Trace>('/api/traces', {
    method: 'POST',
    body: JSON.stringify({ trace }),
  })
}

export function postCompare(baseline: number[], candidate: number[]): Promise<CompareResult> {
  return request<CompareResult>('/api/compare', {
    method: 'POST',
    body: JSON.stringify({
      baseline,
      candidate,
      alpha: COMPARE_ALPHA,
    }),
  })
}

function assertDemoPrompt(item: unknown, index: number): DemoPrompt {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new ApiError(200, `Demo prompt ${index + 1} is not an object.`)
  }
  const row = item as Record<string, unknown>
  if (
    typeof row.text !== 'string' ||
    typeof row.label !== 'string' ||
    (row.category !== null && typeof row.category !== 'string')
  ) {
    throw new ApiError(200, `Demo prompt ${index + 1} must include text and label strings and a category string or null.`)
  }
  return { text: row.text, label: row.label, category: row.category }
}

function assertDemoTrace(item: unknown, index: number): DemoTrace {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new ApiError(200, `Demo trace ${index + 1} is not an object.`)
  }
  const row = item as Record<string, unknown>
  if (typeof row.trace_id !== 'string' || typeof row.label !== 'string' || !Array.isArray(row.steps)) {
    throw new ApiError(200, `Demo trace ${index + 1} must include trace_id, label, and a steps list.`)
  }
  return item as DemoTrace
}

export async function getDemoPrompts(): Promise<DemoPrompt[]> {
  const body = await request<unknown>('/api/demo/prompts')
  return readList<unknown>(body, 'GET /api/demo/prompts').map((item, index) => assertDemoPrompt(item, index))
}

export async function getDemoTraces(): Promise<DemoTrace[]> {
  const body = await request<unknown>('/api/demo/traces')
  return readList<unknown>(body, 'GET /api/demo/traces').map((item, index) => assertDemoTrace(item, index))
}

export function postSpecimens(text: string): Promise<Specimens> {
  return request<Specimens>('/api/evasion/specimens', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export function getEvasionLedger(): Promise<EvasionLedger> {
  return request<EvasionLedger>('/api/evasion/ledger')
}
