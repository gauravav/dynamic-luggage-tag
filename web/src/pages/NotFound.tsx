import { Link } from 'react-router-dom'
import { SwingingTag } from '../components/illustrations'
import { TagArt } from '../components/TagArt'
import { FALLBACK_DESIGN } from '../lib/design'

export function NotFound() {
  return (
    <div className="page wrap wrap--narrow center">
      <div style={{ width: 120, margin: '0 auto 18px' }}>
        {/* A tag dangling loose: nothing is attached to it any more. */}
        <SwingingTag>
          <TagArt design={FALLBACK_DESIGN} crest title="An unattached luggage tag" />
        </SwingingTag>
      </div>
      <p className="kicker">404</p>
      <h1 style={{ fontSize: 30 }}>That page is not here.</h1>
      <p className="muted">The link may be old, or the tag may have been rotated or deleted.</p>
      <Link to="/" className="btn btn--ghost">
        Back to the start
      </Link>
    </div>
  )
}
