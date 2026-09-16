/**
 * Signed-in state.
 *
 * The session itself lives in an HttpOnly cookie the browser will not let this
 * code read, so "am I signed in?" is answered by asking the server, not by
 * inspecting storage. Nothing about the user is cached in localStorage:
 * personal data belongs in memory for the life of the tab and nowhere else.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiError, api, type User } from '../api/client'

interface SessionState {
  user: User | null
  loading: boolean
  refresh: () => Promise<void>
  signIn: (email: string, password: string, codes?: TwoFactor) => Promise<SignInResult>
  signOut: () => Promise<void>
  setUser: (user: User | null) => void
}

export interface TwoFactor {
  totpCode?: string
  recoveryCode?: string
}

export type SignInResult = { status: 'signed_in' } | { status: 'totp_required' }

const SessionContext = createContext<SessionState | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const body = await api.get<{ user: User | null }>('/auth/session')
      setUser(body.user)
    } catch {
      // A failed probe means "not signed in" as far as the UI is concerned;
      // every protected call will surface a real error on its own.
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const signIn = useCallback<SessionState['signIn']>(async (email, password, codes) => {
    const body = await api.post<{ user?: User; status?: string }>('/auth/login', {
      email,
      password,
      ...(codes?.totpCode ? { totp_code: codes.totpCode } : {}),
      ...(codes?.recoveryCode ? { recovery_code: codes.recoveryCode } : {}),
    })
    if (body.status === 'totp_required') return { status: 'totp_required' }
    setUser(body.user ?? null)
    return { status: 'signed_in' }
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout')
    } catch (error) {
      // Already signed out server-side is not a failure worth surfacing.
      if (!(error instanceof ApiError && error.isUnauthenticated)) throw error
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo<SessionState>(
    () => ({ user, loading, refresh, signIn, signOut, setUser }),
    [user, loading, refresh, signIn, signOut],
  )

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
}

export function useSession(): SessionState {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSession must be used inside a SessionProvider')
  return context
}
