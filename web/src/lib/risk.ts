/** Playback treats a step as an incident at this risk. Display only. */
export const INCIDENT_RISK = 0.5

export function isIncident(risk: number): boolean {
  return typeof risk === 'number' && Number.isFinite(risk) && risk >= INCIDENT_RISK
}

/** Neutral mark below the incident line. Red only at or above it. */
export function riskSwatch(risk: number): string {
  if (typeof risk !== 'number' || !Number.isFinite(risk)) return 'var(--muted)'
  return isIncident(risk) ? 'var(--danger)' : 'var(--fg)'
}
