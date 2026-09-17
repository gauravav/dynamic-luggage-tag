import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PageLoader } from './components/PageLoader'
import { Dashboard } from './pages/Dashboard'
import { Inbox } from './pages/Inbox'
import { Landing } from './pages/Landing'
import { Login } from './pages/Login'
import { NotFound } from './pages/NotFound'
import { Register } from './pages/Register'
import { RelayPage } from './pages/RelayPage'
import { ResetPassword, ResetRequest } from './pages/ResetPassword'
import { ScanPage } from './pages/ScanPage'
import { Settings } from './pages/Settings'
import { TagDetail } from './pages/TagDetail'
import { VerifyEmail } from './pages/VerifyEmail'
import { useSession } from './state/session'

export function App() {
  return (
    <Routes>
      {/* Public scan surface: no chrome, no navigation, nothing that hints a
          finder should sign up for anything. */}
      <Route path="/t/:token" element={<ScanPage />} />
      <Route path="/r/:token" element={<RelayPage />} />

      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="/register" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/verify" element={<VerifyEmail />} />
        <Route path="/reset" element={<ResetPassword />} />
        <Route path="/forgot" element={<ResetRequest />} />

        <Route
          path="/app"
          element={
            <RequireUser>
              <Dashboard />
            </RequireUser>
          }
        />
        <Route
          path="/app/tags/:tagId"
          element={
            <RequireUser>
              <TagDetail />
            </RequireUser>
          }
        />
        <Route
          path="/app/inbox"
          element={
            <RequireUser>
              <Inbox />
            </RequireUser>
          }
        />
        <Route
          path="/app/settings"
          element={
            <RequireUser>
              <Settings />
            </RequireUser>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

/**
 * Client-side gate.
 *
 * Convenience only — it decides what to render, never what is permitted. Every
 * protected route is enforced server-side; this just avoids flashing a
 * dashboard shell at someone who is not signed in.
 */
function RequireUser({ children }: { children: React.ReactElement }) {
  const { user, loading } = useSession()
  const location = useLocation()

  if (loading) {
    return (
      <div className="page wrap">
        <PageLoader label="Checking your session" captions={['Checking your session…']} />
      </div>
    )
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return children
}
