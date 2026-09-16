import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api, type User } from '../api/client'
import { Notice } from '../components/ui'
import { useSession } from '../state/session'

export function VerifyEmail() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const { setUser } = useSession()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // StrictMode mounts effects twice in development; the token is single-use,
  // so a second call would fail and show an error for a verification that
  // actually succeeded.
  const attempted = useRef(false)

  useEffect(() => {
    if (!token) {
      setError('That link is missing its token.')
      return
    }
    if (attempted.current) return
    attempted.current = true

    api
      .post<{ user: User }>('/auth/verify-email', { token })
      .then((body) => {
        setUser(body.user)
        navigate('/app', { replace: true })
      })
      .catch((cause) => {
        setError(
          cause instanceof ApiError ? cause.message : 'That link is invalid or has expired.',
        )
      })
  }, [token, setUser, navigate])

  return (
    <div className="page wrap wrap--narrow">
      <p className="kicker">confirming your address</p>
      {error ? (
        <>
          <h1 style={{ fontSize: 26 }}>This link did not work</h1>
          <Notice>{error}</Notice>
          <p className="muted">
            Links expire after 24 hours, and each one can be used only once. Register again to get a
            fresh link.
          </p>
          <Link to="/register" className="btn btn--ghost">
            Start again
          </Link>
        </>
      ) : (
        <p className="row">
          <span className="spinner" aria-hidden="true" /> Confirming&#8230;
        </p>
      )}
    </div>
  )
}
