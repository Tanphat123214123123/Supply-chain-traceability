/**
 * Per-person, per-stage memory of where they last recorded an event — a
 * processor's factory or an inspector's lab rarely changes, so retyping it on
 * every batch is pure friction. Browser-local convenience only; storage can
 * be unavailable (private mode), in which case the field just starts empty.
 */
const key = (actorId: string, stage: string) => `tc.lastLocation.${actorId}.${stage}`

export function rememberLocation(actorId: string, stage: string, location: string): void {
  try {
    if (location) localStorage.setItem(key(actorId, stage), location)
  } catch {
    // ignore — a missing default is harmless
  }
}

export function recallLocation(actorId: string, stage: string): string | null {
  try {
    return localStorage.getItem(key(actorId, stage))
  } catch {
    return null
  }
}
