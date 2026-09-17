import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api, type ThreadSummary } from '../api/client'
import { useSession } from '../state/session'

export function Layout() {
  const { user, signOut } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const unread = useUnreadCount(Boolean(user), location.pathname)

  async function handleSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  return (
    <div className={user ? 'shell shell--app' : 'shell'}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header__inner">
          <Link to={user ? '/app' : '/'} className="brand">
            <motion.span
              className="brand__mark"
              aria-hidden="true"
              whileHover={{ rotate: -8, scale: 1.08 }}
              transition={{ type: 'spring', stiffness: 400, damping: 12 }}
            />
            <span className="brand__name">Dynamic Luggage Tag</span>
          </Link>
          <nav className="nav" aria-label="Main">
            {user ? (
              // On phones these move to the bottom bar; see BottomNav.
              <div className="nav__desktop">
                <TopLink to="/app" end label="Tags" />
                <TopLink to="/app/inbox" label="Inbox" badge={unread} />
                <TopLink to="/app/settings" label="Settings" />
                <button type="button" className="btn btn--quiet" onClick={handleSignOut}>
                  Sign out
                </button>
              </div>
            ) : (
              <>
                <NavLink to="/login">Sign in</NavLink>
                <Link to="/register" className="btn btn--primary btn--sm">
                  <span className="only-wide">Create an account</span>
                  <span className="only-narrow">Sign up</span>
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Keyed on the path, so every page change rises gently into place.
            No exit animation: navigation should feel instant, not wait on
            the page you are leaving. */}
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        >
          <Outlet />
        </motion.div>
      </main>

      <footer className="site-footer">
        One design per traveller &middot; private by default &middot; open core
        <br />
        Licensed under AGPL-3.0.
      </footer>

      {user && <BottomNav unread={unread} />}
    </div>
  )
}

function TopLink({ to, label, end, badge = 0 }: { to: string; label: string; end?: boolean; badge?: number }) {
  return (
    <NavLink to={to} end={end} className="nav__link">
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.span
              layoutId="top-nav-active"
              className="nav__active"
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            />
          )}
          <span className="nav__text">{label}</span>
          <Badge count={badge} />
        </>
      )}
    </NavLink>
  )
}

/**
 * Tab bar for signed-in users on phones: thumb-reachable, always visible, with
 * a highlight that slides between tabs. Hidden on wider screens by CSS.
 */
function BottomNav({ unread }: { unread: number }) {
  const tabs = [
    { to: '/app', label: 'Tags', end: true, icon: <TagIcon /> },
    { to: '/app/inbox', label: 'Inbox', icon: <InboxIcon />, badge: unread },
    { to: '/app/settings', label: 'Settings', icon: <GearIcon /> },
  ]
  return (
    <nav className="bottom-nav" aria-label="App">
      {tabs.map((tab) => (
        <NavLink key={tab.to} to={tab.to} end={tab.end} className="bottom-nav__tab">
          {({ isActive }) => (
            <>
              {isActive && (
                <motion.span
                  layoutId="bottom-nav-active"
                  className="bottom-nav__active"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <motion.span
                className="bottom-nav__icon"
                animate={{ y: isActive ? -1 : 0, scale: isActive ? 1.1 : 1 }}
                whileTap={{ scale: 0.85 }}
                transition={{ type: 'spring', stiffness: 500, damping: 22 }}
              >
                {tab.icon}
                <Badge count={tab.badge ?? 0} />
              </motion.span>
              <span className="bottom-nav__label">{tab.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}

function Badge({ count }: { count: number }) {
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.span
          key="badge"
          className="badge"
          aria-label={`${count} unread`}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          exit={{ scale: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 18 }}
        >
          {count > 9 ? '9+' : count}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/** Unread conversations, refreshed whenever the signed-in user changes page. */
function useUnreadCount(signedIn: boolean, pathname: string): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!signedIn) {
      setCount(0)
      return
    }
    let cancelled = false
    api
      .get<{ threads: ThreadSummary[] }>('/threads')
      .then((body) => {
        if (!cancelled) setCount(body.threads.filter((thread) => thread.unread).length)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [signedIn, pathname])
  return count
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M7 3h10a2 2 0 0 1 2 2v15a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="7" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8.5 13h7M8.5 16.5h4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 13.5 6.2 5.3A2 2 0 0 1 8.1 4h7.8a2 2 0 0 1 1.9 1.3L20 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M4 13.5h4.5l1.2 2.3h4.6l1.2-2.3H20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}
