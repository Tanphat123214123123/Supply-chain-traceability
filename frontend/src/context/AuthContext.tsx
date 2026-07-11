import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import { Actor, ActorRole, authApi, setAccessToken } from '../api/client'

interface AuthState {
  actor: Actor | null
  token: string | null
  isLoading: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  logout: () => void
  hasRole: (...roles: ActorRole[]) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ actor: null, token: null, isLoading: true })
  // Guards against React StrictMode's dev-only double-invoke of this effect:
  // the refresh token is single-use (rotated on every exchange), so firing
  // this call twice on one mount would have the second call race against an
  // already-revoked cookie, 401, and hard-redirect — looping on every
  // subsequent remount. A ref (unlike effect cleanup) survives both invokes.
  const didInitialRefresh = useRef(false)

  useEffect(() => {
    if (didInitialRefresh.current) return
    didInitialRefresh.current = true

    // The access token lives only in memory, so a page reload always needs a
    // fresh one — silently exchange the httpOnly refreshToken cookie for a new
    // access token instead of trusting anything persisted client-side.
    authApi
      .refresh() // already calls setAccessToken + caches 'actor' in localStorage internally
      .then(({ token, actor }) => {
        setState({ token, actor, isLoading: false })
      })
      .catch(() => {
        localStorage.removeItem('actor')
        setState({ token: null, actor: null, isLoading: false })
      })
  }, [])

  const login = async (email: string, password: string) => {
    const { token, actor } = await authApi.login(email, password)
    setAccessToken(token)
    localStorage.setItem('actor', JSON.stringify(actor))
    setState({ token, actor, isLoading: false })
  }

  const logout = () => {
    authApi.logout().catch((err) => console.error('Logout call failed (clearing local session anyway):', err))
    setAccessToken(null)
    localStorage.removeItem('actor')
    setState({ token: null, actor: null, isLoading: false })
  }

  const hasRole = (...roles: ActorRole[]) =>
    !!state.actor && roles.includes(state.actor.role)

  return (
    <AuthContext.Provider value={{ ...state, login, logout, hasRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
