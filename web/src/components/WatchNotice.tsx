/**
 * Tells an owner that a tag looks like it is being polled rather than scanned.
 *
 * The thing being detected is not a person. Nothing here identifies whoever is
 * reading the page — the server counts reads, and nothing about who sent them.
 * Two numbers carry it:
 *
 *   reads that never rendered   a browser that opens the page says so
 *                               afterwards; a script fetching the URL on a
 *                               timer does not
 *   reads with a replaced code  nobody holding the printed tag can produce a
 *                               code the tag has already rotated away from
 *
 * The notice is deliberately calm. Neither signal proves bad intent — a link
 * preview, a security scanner, or a tag that was never reprinted all produce
 * the same numbers — so it says what was counted and what it would mean,
 * rather than accusing anyone.
 */

import { motion } from 'motion/react'
import type { Tag } from '../api/client'
import { relativeTime } from '../lib/design'
import { BusyLabel } from './motion'

export function WatchNotice({
  tag,
  onBlockRetired,
  busy,
}: {
  tag: Tag
  onBlockRetired: () => void
  busy?: boolean
}) {
  const unrendered = Math.max(0, tag.page_fetch_count - tag.scan_count)
  const stale = tag.stale_scan_count

  return (
    <motion.section
      className="card watch-notice"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <div className="watch-notice__head">
        <EyeIcon />
        <h3>This tag looks like it is being watched</h3>
      </div>

      <ul className="watch-notice__counts">
        {unrendered > 0 && (
          <li>
            <strong>{unrendered.toLocaleString()}</strong> read
            {unrendered === 1 ? '' : 's'} of this tag&#8217;s page that never opened in a browser.
          </li>
        )}
        {stale > 0 && (
          <li>
            <strong>{stale.toLocaleString()}</strong> read{stale === 1 ? '' : 's'} using a code you
            have already replaced. Nobody holding the tag itself can produce one of those.
            {tag.last_stale_scan_at && <> Last seen {relativeTime(tag.last_stale_scan_at)}.</>}
          </li>
        )}
      </ul>

      <p className="muted">
        It may be nothing — a link preview, or a tag you never reprinted. But someone who scanned
        this bag while it was safe can keep the link and wait for you to report it lost.
      </p>

      <p className="muted">
        {tag.name_disclosure === 'always' ? (
          <>
            <strong>Your name is set to show to anyone who scans this tag.</strong> With a saved
            link in circulation, that means whoever kept it. Changing it below to release your name
            only when you reply costs a genuine finder nothing.
          </>
        ) : (
          <>
            Your name is not published to whoever holds a code, so a saved link is worth very
            little — it shows that the bag is lost and offers a message form, nothing more.
          </>
        )}
      </p>

      {stale > 0 && !tag.block_retired_tokens && (
        <div className="watch-notice__action">
          <p className="faint">
            Replaced codes still work so a bag on an un-reprinted tag can come home. Once you have
            reprinted this tag and written the new code to its sticker, you can switch the old ones
            off for good.
          </p>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onBlockRetired} disabled={busy}>
            <BusyLabel busy={Boolean(busy)} idle="I have reprinted — stop old codes" working="Saving…" />
          </button>
        </div>
      )}
      {tag.block_retired_tokens && (
        <p className="faint" style={{ marginBottom: 0 }}>
          Replaced codes are switched off for this tag. Only the current code resolves.
        </p>
      )}
    </motion.section>
  )
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M1.8 12S5.5 5.5 12 5.5 22.2 12 22.2 12 18.5 18.5 12 18.5 1.8 12 1.8 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}
