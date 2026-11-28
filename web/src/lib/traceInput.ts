import type { TraceInput, TraceStepInput } from '../api'

export type TraceParse = { ok: true; trace: TraceInput } | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Accepts either the trace object itself or the POST body `{ trace: {...} }`.
 * Extra fields such as a demo `label` are dropped. The value sent to the API
 * is only `{ trace_id, steps: [{ tool, args, result }] }`.
 */
export function parseTraceJson(raw: string): TraceParse {
  if (raw.trim() === '') {
    return { ok: false, error: 'Paste a trace, or pick a demo trace.' }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (err) {
    const detail = err instanceof Error && err.message ? ` (${err.message})` : ''
    return {
      ok: false,
      error: `That is not valid JSON${detail}. Check commas, quotes, and brackets.`,
    }
  }

  if (!isRecord(parsed)) {
    return { ok: false, error: 'A trace must be a JSON object, not a list or a bare value.' }
  }

  const inner = parsed.trace
  const trace = isRecord(inner) ? inner : parsed

  if (typeof trace.trace_id !== 'string' || trace.trace_id.trim() === '') {
    return { ok: false, error: 'The trace needs a string trace_id.' }
  }
  if (!Array.isArray(trace.steps)) {
    return { ok: false, error: 'The trace needs a steps array. Each step has tool, args, and result.' }
  }

  const steps: TraceStepInput[] = []
  for (let index = 0; index < trace.steps.length; index += 1) {
    const step = trace.steps[index]
    const label = `Step ${index + 1}`
    if (!isRecord(step)) {
      return { ok: false, error: `${label} must be an object with tool, args, and result.` }
    }
    if ('risk' in step && !('args' in step)) {
      return {
        ok: false,
        error: `${label} looks like a stored analysis. Paste the trace input, with tool, args, and result.`,
      }
    }
    if (typeof step.tool !== 'string' || step.tool.trim() === '') {
      return { ok: false, error: `${label} needs a tool name.` }
    }
    if (!isRecord(step.args)) {
      return { ok: false, error: `${label} needs an args object.` }
    }
    if (typeof step.result !== 'string') {
      return { ok: false, error: `${label} needs a result string.` }
    }
    steps.push({ tool: step.tool, args: step.args, result: step.result })
  }

  return { ok: true, trace: { trace_id: trace.trace_id.trim(), steps } }
}
