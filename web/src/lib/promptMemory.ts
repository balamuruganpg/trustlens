const KEY = 'trustlens-prompt-text'
const CAP = 80

function read(): Record<string, string> {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const store: Record<string, string> = {}
    for (const [id, text] of Object.entries(parsed)) {
      if (typeof text === 'string') store[id] = text
    }
    return store
  } catch {
    return {}
  }
}

/** The API does not return prompt text. Keep the wording we scanned in this tab. */
export function rememberPrompt(id: number, text: string) {
  try {
    const store = read()
    store[String(id)] = text
    const keys = Object.keys(store)
    if (keys.length > CAP) {
      for (const key of keys.slice(0, keys.length - CAP)) delete store[key]
    }
    sessionStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* session storage can be unavailable */
  }
}

export function recallPrompt(id: number): string | null {
  const text = read()[String(id)]
  return typeof text === 'string' ? text : null
}
