/**
 * Whether the mole is showing, shared between the mole and Settings.
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
const CHANGED = 'dlt:mole-preference'

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

/** Subscribes to changes, including ones made in another tab. */
export function onMolePreferenceChange(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) listener()
  }
  window.addEventListener(CHANGED, listener)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED, listener)
    window.removeEventListener('storage', onStorage)
  }
}
