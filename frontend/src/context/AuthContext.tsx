import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { Actor, ActorRole, authApi } from '../api/client'

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

  useEffect(() => {
    const token = localStorage.getItem('token')
    const raw = localStorage.getItem('actor')
    if (token && raw) {
      try {
        setState({ token, actor: JSON.parse(raw) as Actor, isLoading: false })
        return
      } catch {
        // corrupted storage — fall through
      }
    }
    setState((s) => ({ ...s, isLoading: false }))
  }, [])

  const login = async (email: string, password: string) => {
    const { token, actor } = await authApi.login(email, password)
    localStorage.setItem('token', token)
    localStorage.setItem('actor', JSON.stringify(actor))
    setState({ token, actor, isLoading: false })
  }

  const logout = () => {
    localStorage.removeItem('token')
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
