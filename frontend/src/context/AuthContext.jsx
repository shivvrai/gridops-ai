import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { DEMO_USERS } from '../mockData'

const AuthContext = createContext(null)

// Demo mode: true when no backend API URL is explicitly set
const VITE_API = import.meta.env.VITE_API_BASE_URL || ''
const IS_DEMO = !VITE_API

export function AuthProvider({ children, apiUrl }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('gridops_token'))
  const [loading, setLoading] = useState(true)
  const [demoMode, setDemoMode] = useState(IS_DEMO)

  // Verify stored token on boot
  useEffect(() => {
    const verifyToken = async () => {
      const storedToken = localStorage.getItem('gridops_token')
      if (!storedToken) {
        setLoading(false)
        return
      }

      // Demo mode: restore user from localStorage
      if (demoMode) {
        const storedUser = localStorage.getItem('gridops_demo_user')
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser))
            setToken(storedToken)
          } catch {
            localStorage.removeItem('gridops_token')
            localStorage.removeItem('gridops_demo_user')
            setToken(null)
          }
        } else {
          localStorage.removeItem('gridops_token')
          setToken(null)
        }
        setLoading(false)
        return
      }

      // Real mode: verify with backend
      try {
        const res = await fetch(`${apiUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        })
        if (res.ok) {
          const userData = await res.json()
          setUser(userData)
          setToken(storedToken)
        } else {
          localStorage.removeItem('gridops_token')
          setToken(null)
          setUser(null)
        }
      } catch (err) {
        // Backend unreachable — switch to demo mode
        console.warn('Backend unreachable, switching to demo mode:', err.message)
        setDemoMode(true)
        const storedUser = localStorage.getItem('gridops_demo_user')
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser))
          } catch {
            localStorage.removeItem('gridops_token')
            localStorage.removeItem('gridops_demo_user')
            setToken(null)
          }
        } else {
          localStorage.removeItem('gridops_token')
          setToken(null)
        }
      } finally {
        setLoading(false)
      }
    }

    verifyToken()
  }, [apiUrl, demoMode])

  const login = async (email, password) => {
    // Demo mode: validate locally
    if (demoMode) {
      const demoUser = DEMO_USERS[email]
      if (!demoUser || demoUser.password !== password) {
        throw new Error('Invalid email or password')
      }
      const fakeToken = `demo-token-${Date.now()}`
      localStorage.setItem('gridops_token', fakeToken)
      localStorage.setItem('gridops_demo_user', JSON.stringify(demoUser.user))
      setToken(fakeToken)
      setUser(demoUser.user)
      return demoUser.user
    }

    // Real mode: call backend
    try {
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Login failed')
      }

      localStorage.setItem('gridops_token', data.access_token)
      setToken(data.access_token)
      setUser(data.user)
      return data.user
    } catch (err) {
      // If backend is unreachable, try demo mode
      if (err.message === 'Failed to fetch' || err.name === 'TypeError') {
        console.warn('Backend unreachable during login, falling back to demo mode')
        setDemoMode(true)
        const demoUser = DEMO_USERS[email]
        if (!demoUser || demoUser.password !== password) {
          throw new Error('Backend unavailable. Use demo credentials: admin@gridops.ai / admin123')
        }
        const fakeToken = `demo-token-${Date.now()}`
        localStorage.setItem('gridops_token', fakeToken)
        localStorage.setItem('gridops_demo_user', JSON.stringify(demoUser.user))
        setToken(fakeToken)
        setUser(demoUser.user)
        return demoUser.user
      }
      throw err
    }
  }

  const logout = useCallback(() => {
    localStorage.removeItem('gridops_token')
    localStorage.removeItem('gridops_demo_user')
    setToken(null)
    setUser(null)
  }, [])

  // Helper fetch that automatically attaches Bearer token
  const authFetch = useCallback(async (url, options = {}) => {
    const headers = { ...options.headers }
    const currentToken = localStorage.getItem('gridops_token')
    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`
    }
    return fetch(url, { ...options, headers })
  }, [])

  const isAdmin = user?.role === 'ADMIN'
  const isOperator = user?.role === 'OPERATOR' || user?.role === 'ADMIN'
  const isFieldCrew = user?.role === 'FIELD_CREW'

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        logout,
        authFetch,
        isAdmin,
        isOperator,
        isFieldCrew,
        demoMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
