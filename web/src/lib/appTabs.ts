/**
 * Handing a scanned tag to the app tab that is already open.
 *
 * Tapping an NFC sticker makes the phone open the tag's URL, and the phone
 * decides to do that in a brand new tab every single time. Someone who taps
 * four bags in a row ends up with four tabs, none of them the one they were
 * working in.
 *
 * So before the scan page navigates anywhere, it asks over a BroadcastChannel
 * whether another tab of this app is open. If one answers, that tab moves to
 * the tag and this one stops where it is and says so. A BroadcastChannel is
 * exactly the right scope for the question: same browser, same profile, same
 * origin — which is the same thing as "the browser I am already signed in on".
 *
 * Nothing here is load-bearing. If the API is missing, or no tab answers in
 * time, the scan page simply navigates itself and the person gets the extra
 * tab they would have had anyway.
 */

import { useEffect } from 'react'

const CHANNEL_NAME = 'dlt-open-tags'

/** Long enough for another tab to answer, short enough not to be felt. */
const CLAIM_TIMEOUT_MS = 400

type Message =
  | { type: 'claim'; nonce: string; tagId: string }
  | { type: 'claimed'; nonce: string }

function open(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null
  } catch {
    return null
  }
}

/**
 * Asks any other open tab to show this tag.
 *
 * Resolves true if one took it, in which case the caller should stay put.
 */
export function askOpenTabToShow(tagId: string): Promise<boolean> {
  const channel = open()
  if (!channel) return Promise.resolve(false)

  const nonce = Math.random().toString(36).slice(2)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (claimed: boolean) => {
      if (settled) return
      settled = true
      channel.close()
      resolve(claimed)
    }

    channel.addEventListener('message', (event: MessageEvent<Message>) => {
      if (event.data?.type === 'claimed' && event.data.nonce === nonce) finish(true)
    })
    channel.postMessage({ type: 'claim', nonce, tagId } satisfies Message)
    window.setTimeout(() => finish(false), CLAIM_TIMEOUT_MS)
  })
}

/**
 * Answers those claims, for as long as an app tab is mounted.
 *
 * Only one tab needs to answer, and every listening tab answers, so the
 * scanning tab takes the first reply and ignores the rest.
 */
export function useOpenTagHandoff(show: (tagId: string) => void): void {
  useEffect(() => {
    const channel = open()
    if (!channel) return

    const onMessage = (event: MessageEvent<Message>) => {
      const message = event.data
      if (message?.type !== 'claim') return
      channel.postMessage({ type: 'claimed', nonce: message.nonce } satisfies Message)
      show(message.tagId)
      // Best effort only: a browser will not raise a background tab without a
      // gesture, which is why the scanning tab also says where the tag went.
      try {
        window.focus()
      } catch {
        /* not permitted here; the other tab explains instead */
      }
    }

    channel.addEventListener('message', onMessage)
    return () => {
      channel.removeEventListener('message', onMessage)
      channel.close()
    }
  }, [show])
}
