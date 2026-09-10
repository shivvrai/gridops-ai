import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

function AuditLogPanel({ apiUrl, demoData }) {
  const { authFetch } = useAuth()
  const [logs, setLogs] = useState(demoData || [])
  const [loading, setLoading] = useState(!demoData)
  const [actionFilter, setActionFilter] = useState('')

  const fetchLogs = useCallback(async () => {
    if (demoData) { setLogs(demoData); setLoading(false); return }
    setLoading(true)
    try {
      const url = actionFilter
        ? `${apiUrl}/api/audit/?action=${encodeURIComponent(actionFilter)}`
        : `${apiUrl}/api/audit/`
      const res = await authFetch(url)
      if (res.ok) setLogs(await res.json())
    } catch (err) {
      console.error('Failed to fetch audit logs:', err)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, actionFilter, authFetch, demoData])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const formatTimestamp = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-IN', {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
  }

  const getActionBadgeClass = (action) => {
    if (action.includes('FAILED')) return 'status-pill-fault'
    if (action.includes('LOGIN')) return 'status-pill-healthy'
    if (action.includes('TICKET') || action.includes('CREW')) return 'status-pill-active'
    return 'status-pill-healthy'
  }

  return (
    <div className="audit-log-container">
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">📜</span>
          <span className="dash-card-title">System Audit Log</span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              style={{ fontSize: 11, padding: '2px 6px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
            >
              <option value="">All Operations</option>
              <option value="LOGIN">LOGIN</option>
              <option value="FAILED_LOGIN">FAILED_LOGIN</option>
              <option value="TICKET_TRANSITION">TICKET_TRANSITION</option>
              <option value="CREW_ASSIGNED">CREW_ASSIGNED</option>
              <option value="FIELD_STATUS_UPDATE">FIELD_STATUS_UPDATE</option>
              <option value="USER_CREATED">USER_CREATED</option>
              <option value="USER_UPDATED">USER_UPDATED</option>
            </select>
            <button className="btn btn-xs btn-secondary" onClick={fetchLogs}>
              🔄 Refresh
            </button>
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px' }}>
          Cryptographically recorded operations with user identity, client IP, and entity details.
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
            Loading audit records...
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
            No audit logs match current filter.
          </div>
        ) : (
          <div className="audit-table-container">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>User</th>
                  <th>Entity</th>
                  <th>Details</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatTimestamp(log.timestamp)}
                    </td>
                    <td>
                      <span className={`status-pill ${getActionBadgeClass(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td style={{ fontSize: 11 }}>
                      <strong>{log.user_email || 'system'}</strong>
                      {log.user_role && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', display: 'block' }}>
                          {log.user_role}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: 11 }}>
                      {log.entity_type ? `${log.entity_type}: ${log.entity_id || ''}` : '—'}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-secondary)', maxWidth: 200, wordBreak: 'break-all' }}>
                      {log.details ? JSON.stringify(log.details) : '—'}
                    </td>
                    <td style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                      {log.ip_address || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default AuditLogPanel
