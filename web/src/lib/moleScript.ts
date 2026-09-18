/**
 * What the mole has to say, per page.
 *
 * Rules it follows, because a mascot that ignores them is one people want
 * turned off:
 *
 *  - Every line says something true about the thing on screen. No filler, no
 *    "did you know?" about features that do not exist.
 *  - The finder's pages get a different, shorter script. Someone standing at a
 *    carousel holding a stranger's bag is not a prospect, and a chatty
 *    character selling them an account would be the wrong thing entirely.
 *  - Lines that lead somewhere carry the link, so the suggestion is actionable
 *    rather than an instruction to go and find it.
 *
 * Keyed by route rather than passed down, so a page never has to remember to
 * describe itself and no page can forget.
 */

export interface MoleLine {
  text: string
  /** An in-app destination this line is about. */
  to?: string
  cta?: string
}

interface Script {
  /** A greeting, shown once per page visit. */
  greeting: MoleLine
  /** Offered one at a time when nothing is happening. */
  tips: MoleLine[]
}

const LANDING: Script = {
  greeting: { text: 'Hello. I look after luggage tags — ask me what this does.' },
  tips: [
    {
      text: 'Every traveller gets one pattern, on every bag they own. You learn to spot it across a baggage hall.',
    },
    {
      text: 'Scan a tag and you see nothing personal — not until the owner says the bag is lost.',
    },
    {
      text: 'Even then, your name goes to the person who says they have your bag. Not to whoever scanned it.',
    },
    {
      text: 'Your details are sealed with a key of your own. Delete your account and that key is destroyed.',
    },
    {
      text: 'A phone can tap the tag instead of scanning it. Stick the round sticker on the circle marked on the back.',
    },
    {
      text: 'Print it yourself at the exact size, or run the whole thing on your own server.',
    },
    { text: 'Ready when you are.', to: '/register', cta: 'Create an account' },
  ],
}

const TAGS: Script = {
  greeting: { text: 'Your bags. One design across all of them.' },
  tips: [
    { text: 'Holding a tag and not sure which bag it is? Tap Identify and hold it to your phone.' },
    { text: 'Every tag prints at the exact size a supplier asks for, both faces.' },
    { text: 'Nothing here is visible to anyone until you report a bag lost.' },
  ],
}

const TAG_DETAIL: Script = {
  greeting: { text: 'Turn the tag over — the circle is where the NFC sticker goes.' },
  tips: [
    {
      text: 'Issuing a new code costs nothing. The old one still gets a bag home; it just stops being able to publish your name.',
    },
    {
      text: 'Reporting a bag lost lets a finder message you. Your name goes out when you reply, not before.',
    },
    { text: 'The pattern fills the whole tag on purpose. That is what you recognise from a distance.' },
    { text: 'Scan history is deleted on a clock, and the scanner’s address is never stored at all.' },
  ],
}

const INBOX: Script = {
  greeting: { text: 'Messages from people who found a bag.' },
  tips: [
    { text: 'Neither of you sees the other’s number or address. It all goes through here.' },
    { text: 'Replying is what releases your name — to this conversation, and no further.' },
    { text: 'Conversations delete themselves once they go quiet.' },
  ],
}

const SETTINGS: Script = {
  greeting: { text: 'Everything about your account lives here.' },
  tips: [
    { text: 'Two-factor takes a minute: point your phone at the square and type what it shows.' },
    { text: 'Signed in somewhere you do not recognise? Sign out everywhere else.' },
    { text: 'Your address is never shown to a finder, at any setting.' },
  ],
}

const ISSUE: Script = {
  greeting: { text: 'Issue a code, print it, post it.' },
  tips: [
    { text: 'The artwork is decided here, so what you print is what their account ends up with.' },
    { text: 'The code is shown once. Print it now — after that only its owner can.' },
    { text: 'Already have an account? Their new tag matches the ones on their bags.' },
  ],
}

const FINDER: Script = {
  greeting: { text: 'Found a bag? You are in the right place.' },
  tips: [
    { text: 'You do not need an account, and nothing about you is kept unless you choose to share it.' },
  ],
}

const RELAY: Script = {
  greeting: { text: 'They will get a note as soon as you send this.' },
  tips: [{ text: 'Your email address is never shown to them, even if you gave one.' }],
}

const LOST: Script = {
  greeting: { text: 'Nothing here. Shall we go back?' },
  tips: [{ text: 'That page may have moved, or the link may be old.', to: '/', cta: 'Go home' }],
}

/** The script for a path, or null where the mole should stay out of the way. */
export function scriptFor(pathname: string, signedIn: boolean): Script | null {
  const path = pathname.replace(/\/+$/, '') || '/'

  // The sign-in and sign-up pages have a mole of their own, doing a job this
  // one would only talk over.
  if (path === '/login' || path === '/register') return null
  // Confirming an address or resetting a password is someone mid-task with a
  // token in their hand. Nothing to add.
  if (path === '/verify' || path === '/reset' || path === '/forgot') return null

  if (path.startsWith('/t/')) return FINDER
  if (path.startsWith('/r/')) return RELAY
  if (path === '/app') return TAGS
  if (path.startsWith('/app/tags/')) return TAG_DETAIL
  if (path === '/app/inbox') return INBOX
  if (path === '/app/settings') return SETTINGS
  if (path === '/app/issue') return ISSUE
  if (path === '/') return LANDING
  return signedIn ? TAGS : LOST
}
