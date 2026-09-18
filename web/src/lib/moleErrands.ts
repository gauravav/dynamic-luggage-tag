/**
 * The thirty things the mole gets up when it is bored.
 *
 * Every so often it leaves the corner, walks somewhere along the bottom of
 * the window, does something there, says what it found, and comes back. The
 * point is that it is a character rather than a tooltip with a face — but it
 * still only ever says things that are true about this application, so an
 * errand is never purely noise.
 *
 * An errand is data, not code: where it goes, what it does when it arrives,
 * whether it carries something, and the one line it comes back with. The
 * component walks it there and back; nothing here knows about pixels.
 */

/** What the mole does once it arrives. The renderer maps these to motion. */
export type Antic =
  | 'dig' // disappears into the floor and pops up
  | 'hop' // two quick bounces
  | 'spin' // one full turn
  | 'peek' // leans off the bottom edge and back
  | 'stretch' // rises tall, settles
  | 'wobble' // tips left and right
  | 'sit' // drops down and waits
  | 'shiver' // a quick rattle

/** A prop it carries back, drawn beside it. */
export type Prop = 'tag' | 'case' | 'letter' | 'key' | 'magnifier' | 'lamp' | 'seed' | null

export interface Errand {
  id: string
  /** Where it walks to, as a fraction of the window's width. */
  to: number
  antic: Antic
  prop: Prop
  /** What it says on arrival. */
  line: string
}

export const ERRANDS: Errand[] = [
  { id: 'burrow', to: 0.18, antic: 'dig', prop: 'seed', line: 'Digging. It is what I am for.' },
  { id: 'lost-sock', to: 0.3, antic: 'dig', prop: null, line: 'One sock. Not yours, I hope.' },
  { id: 'inspect-belt', to: 0.62, antic: 'peek', prop: null, line: 'Checking the carousel. Nothing going round but the same three bags.' },
  { id: 'find-tag', to: 0.45, antic: 'dig', prop: 'tag', line: 'Found a tag down here. Someone printed it and forgot it.' },
  { id: 'post-letter', to: 0.74, antic: 'hop', prop: 'letter', line: 'Posted. Whoever it was for will get a note, not your address.' },
  { id: 'polish-qr', to: 0.5, antic: 'wobble', prop: 'tag', line: 'Gave the code a polish. It scans better clean.' },
  { id: 'measure', to: 0.24, antic: 'stretch', prop: null, line: '108.4 by 74.1 millimetres. I measured. Twice.' },
  { id: 'lost-key', to: 0.68, antic: 'dig', prop: 'key', line: 'A key. Not the encryption sort — that one never leaves the server.' },
  { id: 'magnify', to: 0.4, antic: 'peek', prop: 'magnifier', line: 'Reading the small print. It says your address is never shown.' },
  { id: 'nap', to: 0.82, antic: 'sit', prop: null, line: 'Short nap. Tags do not lose themselves on a schedule.' },
  { id: 'count-bags', to: 0.36, antic: 'hop', prop: 'case', line: 'Counted the bags. All present, which is the boring outcome and the good one.' },
  { id: 'chase-trolley', to: 0.88, antic: 'spin', prop: null, line: 'A trolley got away from me.' },
  { id: 'check-strap', to: 0.28, antic: 'wobble', prop: 'case', line: 'Strap holds. I pulled on it.' },
  { id: 'listen', to: 0.55, antic: 'sit', prop: null, line: 'Listening for the belt to start. That noise means something arrived.' },
  { id: 'cold', to: 0.2, antic: 'shiver', prop: null, line: 'Draughty by the doors. Somebody left them open.' },
  { id: 'find-lamp', to: 0.72, antic: 'dig', prop: 'lamp', line: 'Better light down here now.' },
  { id: 'label-check', to: 0.46, antic: 'peek', prop: 'tag', line: 'That one says Duffel and it is plainly a backpack. Not my business.' },
  { id: 'queue', to: 0.6, antic: 'sit', prop: null, line: 'Queued at the desk. They had no idea whose bag it was. This is the problem.' },
  { id: 'tunnel', to: 0.14, antic: 'dig', prop: null, line: 'New tunnel. Shorter route to the corner.' },
  { id: 'stack', to: 0.78, antic: 'stretch', prop: 'case', line: 'Stacked them by colour. Nobody asked me to.' },
  { id: 'tap-phone', to: 0.52, antic: 'hop', prop: null, line: 'Tapped a phone against a sticker. It just opened. No app, nothing to install.' },
  { id: 'seed', to: 0.33, antic: 'dig', prop: 'seed', line: 'Planted something. It will be a pattern by morning.' },
  { id: 'scuff', to: 0.66, antic: 'wobble', prop: null, line: 'Scuffed a tag to see if it still scanned. It did. That is the error correction.' },
  { id: 'watch-plane', to: 0.86, antic: 'stretch', prop: null, line: 'Watched a plane go over. Somebody’s bag was on it.' },
  { id: 'sweep', to: 0.42, antic: 'spin', prop: null, line: 'Swept up. Found nothing personal, which is rather the point.' },
  { id: 'lost-glove', to: 0.26, antic: 'dig', prop: null, line: 'A glove. Left-handed. I will leave it where it was.' },
  { id: 'read-notice', to: 0.58, antic: 'peek', prop: 'magnifier', line: 'The notice says scan history is deleted on a clock. It is.' },
  { id: 'echo', to: 0.9, antic: 'shiver', prop: null, line: 'It echoes at this end. Try it.' },
  { id: 'carry-case', to: 0.5, antic: 'hop', prop: 'case', line: 'Carried this the whole way. It was not heavy. It was not mine either.' },
  { id: 'home', to: 0.22, antic: 'sit', prop: 'tag', line: 'A bag went home today. That is the whole job.' },
]

/**
 * A shuffled run through every errand before any repeats.
 *
 * A random pick each time would show the same three all afternoon and leave
 * most of these unseen, which is the usual fate of content like this.
 */
export function errandOrder(): Errand[] {
  const deck = [...ERRANDS]
  for (let index = deck.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[deck[index], deck[swap]] = [deck[swap]!, deck[index]!]
  }
  return deck
}
