import { useState } from 'react'
import { useAuth } from '../context/AuthContext'

function LoginModal({ onLoginSuccess }) {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    if (e) e.preventDefault()
    if (!email || !password) {
      setError('Please enter both email and password')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await login(email, password)
      if (onLoginSuccess) onLoginSuccess()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleQuickLogin = (roleEmail, rolePass) => {
    setEmail(roleEmail)
    setPassword(rolePass)
    setError(null)
  }

  return (
    <div className="login-overlay">
      <div className="login-card">
        <div className="login-header">
          <div className="login-badge">⚡ GRIDOPS-AI</div>
          <h2>Control Room Sign In</h2>
          <p>Access power distribution fault localization, operations, and dispatch.</p>
        </div>

        {error && (
          <div className="login-error">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-input-group">
            <label>Work Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. operator@gridops.ai"
              required
              autoFocus
            />
          </div>

          <div className="login-input-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading}
          >
            {loading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="quick-login-section">
          <div className="quick-login-label">Demo Quick-Fill Credentials:</div>
          <div className="quick-login-buttons">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => handleQuickLogin('admin@gridops.ai', 'admin123')}
            >
              🛡️ Admin
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => handleQuickLogin('operator@gridops.ai', 'operator123')}
            >
              🖥️ Operator
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => handleQuickLogin('crew@gridops.ai', 'crew123')}
            >
              👷 Field Crew
            </button>
          </div>
        </div>

        <div className="login-footer">
          Role-based permissions are enforced by backend security policies.
        </div>
      </div>
    </div>
  )
}

export default LoginModal
