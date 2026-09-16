import { Link } from 'react-router-dom'

export function NotFound() {
  return (
    <div className="page wrap wrap--narrow center">
      <p className="kicker">404</p>
      <h1 style={{ fontSize: 30 }}>That page is not here.</h1>
      <p className="muted">The link may be old, or the tag may have been rotated or deleted.</p>
      <Link to="/" className="btn btn--ghost">
        Back to the start
      </Link>
    </div>
  )
}
