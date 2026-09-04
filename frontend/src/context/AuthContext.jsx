import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children, apiUrl }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem('gridops_token'))
  const [loading, setLoading] = useState(true)

  // Verify stored token on boot
  useEffect(() => {
    const verifyToken = async () => {
      const storedToken = localStorage.getItem('gridops_token')
      if (!storedToken) {
        setLoading(false)
        return
      }

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
        console.error('Failed to verify session token:', err)
      } finally {
        setLoading(false)
      }
    }

    verifyToken()
  }, [apiUrl])

  const login = async (email, password) => {
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
  }

  const logout = useCallback(() => {
    localStorage.removeItem('gridops_token')
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
