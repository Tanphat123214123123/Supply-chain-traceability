import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Login from './Login'
import { AuthProvider } from '../context/AuthContext'
import { authApi } from '../api/client'

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    authApi: {
      login: vi.fn(),
      logout: vi.fn(),
      // AuthProvider always calls refresh() on mount to silently restore a
      // session from the httpOnly cookie — reject by default so tests start
      // logged out, same as before there was a cookie to restore from.
      refresh: vi.fn().mockRejectedValue(new Error('no session')),
    },
    setAccessToken: vi.fn(),
  }
})

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<div>Dashboard Page</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authApi.refresh).mockRejectedValue(new Error('no session'))
    localStorage.clear()
  })

  it('logs in and navigates to the dashboard on success', async () => {
    vi.mocked(authApi.login).mockResolvedValue({
      token: 'tok',
      actor: {
        id: '1', name: 'Farmer', role: 'FARMER', email: 'farmer@demo.com',
        organization: 'x', createdAt: '', isActive: true,
      },
    })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'farmer@demo.com')
    await user.type(screen.getByPlaceholderText('••••••••'), 'demo1234')
    await user.click(screen.getByRole('button', { name: /Đăng nhập/ }))

    await waitFor(() => expect(screen.getByText('Dashboard Page')).toBeInTheDocument())
    expect(JSON.parse(localStorage.getItem('actor') ?? '{}').email).toBe('farmer@demo.com')
  })

  it('shows an inline error on invalid credentials without navigating away', async () => {
    vi.mocked(authApi.login).mockRejectedValue({ response: { data: { error: 'Invalid credentials' } } })
    const user = userEvent.setup()
    renderLogin()

    await user.type(screen.getByPlaceholderText('you@example.com'), 'farmer@demo.com')
    await user.type(screen.getByPlaceholderText('••••••••'), 'wrong')
    await user.click(screen.getByRole('button', { name: /Đăng nhập/ }))

    expect(await screen.findByText('Invalid credentials')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard Page')).not.toBeInTheDocument()
    expect(localStorage.getItem('actor')).toBeNull()
  })
})
