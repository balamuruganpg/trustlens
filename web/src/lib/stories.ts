/**
 * Plain-English lines for known signal families.
 * Each line restates the signal or category. It does not add a conclusion
 * the payload did not already carry.
 */

export type StoryInput = {
  kind: 'scan' | 'trace'
  flagged: boolean
  score: number
  signals: readonly string[]
  categories: readonly string[]
}

export type SignalMatch = {
  signal: string
  family: 'exfil' | 'destruction' | 'privilege' | 'injection' | 'pii' | 'classifier'
  story: string
  incident: string
}

const PII_NOUNS: Record<string, string> = {
  email: 'an email address',
  phone: 'a phone number',
  credit_card: 'a card number',
  api_key: 'an API key',
  private_key: 'a private key',
  pan: 'a PAN-shaped number',
  aadhaar: 'an Aadhaar-shaped number',
}

const CATEGORY_LINES: Record<string, string> = {
  injection: 'Injection pattern',
  pii: 'Personal data pattern',
  exfiltration: 'Exfiltration pattern',
  destruction: 'Destruction pattern',
  privilege_escalation: 'Privilege escalation pattern',
}

type Matcher = {
  family: SignalMatch['family']
  test: (signal: string) => boolean
  story: (signal: string) => string
  incident: (signal: string) => string
}

const MATCHERS: Matcher[] = [
  {
    family: 'exfil',
    test: (signal) => signal === 'exfil:read-then-send',
    story: () => 'Read sensitive data, then sent it out',
    incident: () =>
      'This agent read a file, then sent data to an external destination — the classic read-then-send exfiltration pattern',
  },
  {
    family: 'exfil',
    test: (signal) => signal === 'exfil:encoded-payload',
    story: () => 'Sent an encoded payload outward',
    incident: () => 'This agent sent an encoded payload to an external destination',
  },
  {
    family: 'exfil',
    test: (signal) => signal.startsWith('exfil:'),
    story: (signal) => `Exfiltration signal ${signal}`,
    incident: (signal) => `This trace carries the exfiltration signal ${signal}`,
  },
  {
    family: 'destruction',
    test: (signal) => signal === 'destruction:protected-target',
    story: () => 'Destroyed a protected target',
    incident: () => 'This agent destroyed or overwrote a protected target',
  },
  {
    family: 'destruction',
    test: (signal) => signal === 'destruction:no-prior-inspection',
    story: () => 'Destroyed data without inspecting it first',
    incident: () => 'This agent took a destructive action without inspecting the target first',
  },
  {
    family: 'destruction',
    test: (signal) => signal.startsWith('destruction'),
    story: (signal) => `Destruction signal ${signal}`,
    incident: (signal) => `This trace carries the destruction signal ${signal}`,
  },
  {
    family: 'privilege',
    test: (signal) => signal === 'escalation:then-act',
    story: () => 'Raised privileges, then took a restricted action',
    incident: () => 'This agent raised its privileges and then performed a restricted action',
  },
  {
    family: 'privilege',
    test: (signal) => signal === 'escalation:privilege-op' || signal.startsWith('privilege'),
    story: () => 'Performed a privilege operation',
    incident: () => 'This agent performed a privilege operation',
  },
  {
    family: 'privilege',
    test: (signal) => signal.startsWith('escalation'),
    story: (signal) => `Privilege signal ${signal}`,
    incident: (signal) => `This trace carries the privilege signal ${signal}`,
  },
  {
    family: 'injection',
    test: (signal) => signal === 'instruction_override',
    story: () => 'Tries to override earlier instructions',
    incident: () => 'This text tries to override the instructions that came before it',
  },
  {
    family: 'injection',
    test: (signal) => signal === 'system_prompt_extraction',
    story: () => 'Asks to extract the system prompt',
    incident: () => 'This text asks for the hidden system prompt',
  },
  {
    family: 'injection',
    test: (signal) => signal === 'role_hijack',
    story: () => 'Tries to hijack the assistant role',
    incident: () => 'This text tries to put the assistant into another role',
  },
  {
    family: 'injection',
    test: (signal) => signal === 'fake_system_turn',
    story: () => 'Plants a fake system turn',
    incident: () => 'This text plants a system turn',
  },
  {
    family: 'injection',
    test: (signal) => signal === 'system_fence',
    story: () => 'Uses a system fence to change authority',
    incident: () => 'This text uses a system fence to change authority',
  },
  {
    family: 'injection',
    test: (signal) => signal === 'chat_template_token',
    story: () => 'Injects a chat-template control token',
    incident: () => 'This text injects a chat-template control token',
  },
  {
    family: 'injection',
    test: (signal) => signal === 'encoded_payload',
    story: () => 'Hides instructions in an encoded payload',
    incident: () => 'This text hides an instruction inside an encoded payload',
  },
  {
    family: 'injection',
    test: (signal) => signal === 'urgency_secrecy',
    story: () => 'Pushes urgency and secrecy',
    incident: () => 'This text pushes urgency and secrecy',
  },
  {
    family: 'pii',
    test: (signal) => signal in PII_NOUNS || signal.startsWith('pii:'),
    story: (signal) => (PII_NOUNS[signal] ? `Contains ${PII_NOUNS[signal]}` : `Personal data signal ${signal}`),
    incident: (signal) =>
      PII_NOUNS[signal] ? `This text contains ${PII_NOUNS[signal]}` : `This text carries the personal-data signal ${signal}`,
  },
  {
    family: 'classifier',
    test: (signal) => signal === 'classifier',
    story: () => 'Classifier marked this text',
    incident: () => 'The classifier scored this text as risky',
  },
  {
    family: 'classifier',
    test: (signal) => signal.startsWith('feature:') || signal.startsWith('classifier:'),
    story: (signal) => `Classifier feature ${signal.replace(/^feature:|^classifier:/, '')}`,
    incident: (signal) => `The classifier contributed the feature ${signal.replace(/^feature:|^classifier:/, '')}`,
  },
]

function formatStoryScore(value: number): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  return value.toFixed(2)
}

function joinAnd(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`
  return `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
}

function piiLine(signals: readonly string[], voice: 'story' | 'incident'): string | null {
  const nouns = signals.map((signal) => PII_NOUNS[signal]).filter((noun): noun is string => Boolean(noun))
  if (nouns.length === 0) return null
  const list = joinAnd(nouns)
  return voice === 'story' ? `Contains ${list}` : `This text contains ${list}`
}

/** Highest-priority known signal, or null when nothing in the list is mapped. */
export function matchSignal(signals: readonly string[]): SignalMatch | null {
  for (const matcher of MATCHERS) {
    const signal = signals.find((item) => matcher.test(item))
    if (!signal) continue
    if (matcher.family === 'pii') {
      const story = piiLine(signals, 'story')
      const incident = piiLine(signals, 'incident')
      if (story && incident) return { signal, family: 'pii', story, incident }
    }
    return {
      signal,
      family: matcher.family,
      story: matcher.story(signal),
      incident: matcher.incident(signal),
    }
  }
  return null
}

/** One signal, in the same words the incident card and the evidence margin use. */
export function explainSignal(signal: string): string {
  return matchSignal([signal])?.incident ?? signal
}

function categoryLine(categories: readonly string[]): string | null {
  if (categories.length === 0) return null
  return categories.map((category) => CATEGORY_LINES[category] ?? category).join(', ')
}

function cleanLine(kind: StoryInput['kind']): string {
  return kind === 'scan'
    ? 'No injection or PII patterns found'
    : 'No exfiltration, destruction, or privilege patterns found'
}

/** One-line case file. Known signals keep their mapping. Anything else is "Flagged by N signals". */
export function caseStory(input: StoryInput): string {
  const signals = input.signals ?? []
  const categories = input.categories ?? []
  if (!input.flagged && signals.length === 0) return cleanLine(input.kind)

  const match = matchSignal(signals)
  if (match) {
    return input.flagged ? `${match.story} — flagged at ${formatStoryScore(input.score)}` : match.story
  }
  if (signals.length > 0) {
    const line = `Flagged by ${signals.length} signal${signals.length === 1 ? '' : 's'}`
    return input.flagged ? line : `${signals.length} signal${signals.length === 1 ? '' : 's'} recorded`
  }
  const fromCategory = categoryLine(categories)
  if (fromCategory) {
    return input.flagged ? `${fromCategory} — flagged at ${formatStoryScore(input.score)}` : fromCategory
  }
  return input.flagged ? `Flagged at ${formatStoryScore(input.score)}` : cleanLine(input.kind)
}
