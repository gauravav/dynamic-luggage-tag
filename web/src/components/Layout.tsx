import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useSession } from '../state/session'

export function Layout() {
  const { user, signOut } = useSession()
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to={user ? '/app' : '/'} className="brand">
            <span className="brand__mark" aria-hidden="true" />
            Dynamic Luggage Tag
          </Link>
          <nav className="nav" aria-label="Main">
            {user ? (
              <>
                <NavLink to="/app" end>
                  Tags
                </NavLink>
                <NavLink to="/app/inbox">Inbox</NavLink>
                <NavLink to="/app/settings">Settings</NavLink>
                <button type="button" className="btn btn--quiet" onClick={handleSignOut}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <Link to="/register" className="btn btn--primary btn--sm">
                  Create an account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main">
        <Outlet />
      </main>

      <footer className="site-footer">
        One design per traveller &middot; private by default &middot; open core
        <br />
        Licensed under AGPL-3.0.
      </footer>
    </>
  )
}
