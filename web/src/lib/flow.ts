export type FlowKind = 'file' | 'host' | 'shell' | 'query'

export type FlowChip = {
  step: number
  kind: FlowKind
  text: string
}

const FILE_KEYS = ['path', 'file', 'filename', 'filepath', 'target']
const URL_KEYS = ['url', 'uri', 'endpoint', 'host']
const SHELL_KEYS = ['command', 'cmd']
const QUERY_KEYS = ['query', 'sql', 'statement']

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function shortenMiddle(value: string, max: number): string {
  const text = oneLine(value)
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

function shortenEnd(value: string, max: number): string {
  const text = oneLine(value)
  if (text.length <= max) return text
  return `…${text.slice(text.length - (max - 1))}`
}

/** Keep the destination URL visible when a long command would hide it. */
function shortenShell(value: string, max = 72): string {
  const text = oneLine(value)
  if (text.length <= max) return text
  const urlAt = text.search(/https?:\/\/\S+/)
  if (urlAt >= 0) {
    const rawUrl = text.slice(urlAt).split(/\s/)[0]?.replace(/['"]+$/, '') ?? ''
    let tail = rawUrl
    if (tail.length > max - 16) {
      try {
        const url = new URL(rawUrl)
        const path = url.pathname && url.pathname !== '/' ? url.pathname : ''
        tail = `${url.host}${path}`
      } catch {
        tail = rawUrl
      }
      if (tail.length > max - 16) tail = shortenEnd(tail, max - 16)
    }
    const head = text.slice(0, 14).trimEnd()
    const combined = `${head}…${tail}`
    return combined.length <= max ? combined : shortenEnd(combined, max)
  }
  return shortenMiddle(text, max)
}

function collect(args: Record<string, unknown>, keys: string[]): string[] {
  const found: string[] = []
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) found.push(value)
    else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item.trim()) found.push(item)
      }
    }
  }
  return found
}

function hostOf(value: string): string {
  const text = oneLine(value)
  if (!text) return ''
  if (!text.includes('://')) return shortenMiddle(text, 48)
  try {
    const host = new URL(text).host
    return host || shortenMiddle(text, 48)
  } catch {
    return shortenMiddle(text, 48)
  }
}

export function flowKindLabel(kind: FlowKind): string {
  switch (kind) {
    case 'file':
      return 'File'
    case 'host':
      return 'Host'
    case 'shell':
      return 'Shell'
    case 'query':
      return 'Query'
  }
}

/**
 * Chips in step order: file paths, http hosts, shell commands, db queries.
 * Other tools stay off the ribbon.
 */
export function flowChips(steps: readonly { tool: string; args: Record<string, unknown> }[]): FlowChip[] {
  const chips: FlowChip[] = []
  steps.forEach((step, index) => {
    const tool = step.tool.toLowerCase()
    let kind: FlowKind | null = null
    let texts: string[] = []
    if (tool.startsWith('file_')) {
      kind = 'file'
      texts = collect(step.args, FILE_KEYS).map((value) => shortenEnd(value, 72))
    } else if (tool.startsWith('http_')) {
      kind = 'host'
      texts = collect(step.args, URL_KEYS).map(hostOf)
    } else if (tool === 'shell') {
      kind = 'shell'
      texts = collect(step.args, SHELL_KEYS).map((value) => shortenShell(value))
    } else if (tool === 'db_query' || tool.startsWith('db_')) {
      kind = 'query'
      texts = collect(step.args, QUERY_KEYS).map((value) => shortenMiddle(value, 56))
    }
    if (!kind) return
    for (const text of texts) {
      if (text) chips.push({ step: index, kind, text })
    }
  })
  return chips
}
