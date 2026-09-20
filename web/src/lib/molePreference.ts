/**
 * Whether the mole is showing and where it sits, shared with Settings.
 *
 * It lives in this browser rather than on the account: it is a preference
 * about this screen, not about the person, and someone who turns it off on a
 * phone has said nothing about their laptop. That also means it costs no
 * request and works signed out.
 *
 * Two places read it and either can change it, so it is a tiny store with
 * subscribers rather than a `useState` in one component — otherwise turning it
 * back on in Settings would not bring it back until a reload.
 */

const KEY = 'dlt.mole.dismissed'
const SPOT_KEY = 'dlt.mole.spot'
const CHANGED = 'dlt:mole-preference'

/** How far the mole has been dragged from its corner, in pixels. */
export interface MoleSpot {
  x: number
  y: number
}

export const HOME: MoleSpot = { x: 0, y: 0 }

export function moleIsHidden(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    // Private windows and blocked storage both throw. The mole shows up.
    return false
  }
}

export function setMoleHidden(hidden: boolean): void {
  try {
    if (hidden) window.localStorage.setItem(KEY, '1')
    else window.localStorage.removeItem(KEY)
  } catch {
    // The change still takes effect for this tab; it just will not survive a
    // reload. Better than refusing to act on what someone asked for.
  }
  window.dispatchEvent(new CustomEvent(CHANGED))
}

/**
 * Where the mole was left, or the corner.
 *
 * Anything unreadable — a half-written value, a different version of this
 * app, a blocked store — is treated as "never moved" rather than trusted,
 * because a bad number here would park the mole off the edge of the screen.
 */
export function moleSpot(): MoleSpot {
  try {
    const raw = window.localStorage.getItem(SPOT_KEY)
    if (!raw) return HOME
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return HOME
    const { x, y } = parsed as Partial<MoleSpot>
    if (!Number.isFinite(x) || !Number.isFinite(y)) return HOME
    return { x: x as number, y: y as number }
  } catch {
    return HOME
  }
}

export function setMoleSpot(spot: MoleSpot): void {
  try {
    if (spot.x === 0 && spot.y === 0) window.localStorage.removeItem(SPOT_KEY)
    else window.localStorage.setItem(SPOT_KEY, JSON.stringify(spot))
  } catch {
    // As above: the move still holds for this tab, it just will not survive.
  }
  window.dispatchEvent(new CustomEvent(CHANGED))
}

export function moleHasMoved(): boolean {
  const spot = moleSpot()
  return spot.x !== 0 || spot.y !== 0
}

/** Subscribes to changes, including ones made in another tab. */
export function onMolePreferenceChange(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === SPOT_KEY || event.key === null) listener()
  }
  window.addEventListener(CHANGED, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED, listener)
    window.removeEventListener('storage', onStorage)
  }
}
