import { useState, useEffect, useCallback } from 'react'

function OutageManagementPanel({ apiUrl, onRefreshOutages, demoData }) {
  const [outages, setOutages] = useState(demoData || [])
  const [loading, setLoading] = useState(!demoData)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    scope: 'feeder',
    target_id: '',
    reason: 'Planned maintenance',
    scheduled_start: '',
    scheduled_end: '',
  })

  const fetchOutages = useCallback(async () => {
    if (demoData) { setOutages(demoData); setLoading(false); return }
    try {
      const res = await fetch(`${apiUrl}/api/scheduled-outages/?active_only=false`)
      if (res.ok) setOutages(await res.json())
    } catch (err) {
      console.error('Failed to fetch outages:', err)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, demoData])

  useEffect(() => {
    fetchOutages()
  }, [fetchOutages])

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.target_id || !form.scheduled_start || !form.scheduled_end) return
    try {
      const res = await fetch(`${apiUrl}/api/scheduled-outages/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setShowCreate(false)
        setForm({
          scope: 'feeder',
          target_id: '',
          reason: 'Planned maintenance',
          scheduled_start: '',
          scheduled_end: '',
        })
        await fetchOutages()
        if (onRefreshOutages) onRefreshOutages()
      } else {
        const err = await res.json()
        alert(err.detail || 'Failed to create outage')
      }
    } catch (err) {
      alert(err.message)
    }
  }

  const handleCancel = async (outageId) => {
    if (!window.confirm(`Cancel scheduled outage ${outageId}?`)) return
    try {
      const res = await fetch(`${apiUrl}/api/scheduled-outages/${outageId}/cancel`, {
        method: 'POST',
      })
      if (res.ok) {
        await fetchOutages()
        if (onRefreshOutages) onRefreshOutages()
      }
    } catch (err) {
      alert(err.message)
    }
  }

  const formatTime = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-IN', {
      month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  }

  return (
    <div className="outage-management-container">
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">📅</span>
          <span className="dash-card-title">Scheduled Outages Calendar</span>
          <button
            className="btn btn-xs btn-primary"
            onClick={() => setShowCreate(!showCreate)}
          >
            {showCreate ? '✕ Close' : '+ Schedule Outage'}
          </button>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 10px' }}>
          Planned outages automatically suppress fault tickets and alarms during maintenance windows.
        </p>

        {showCreate && (
          <form onSubmit={handleCreate} className="outage-form">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Scope</label>
                <select
                  value={form.scope}
                  onChange={(e) => setForm({ ...form, scope: e.target.value })}
                  style={{ width: '100%', padding: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                >
                  <option value="feeder">Feeder-wide</option>
                  <option value="dt">Transformer (DT)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Target ID</label>
                <input
                  type="text"
                  placeholder={form.scope === 'feeder' ? 'e.g. F-07-03' : 'e.g. D-0112'}
                  value={form.target_id}
                  onChange={(e) => setForm({ ...form, target_id: e.target.value })}
                  required
                  style={{ width: '100%', padding: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Start Time (Local)</label>
                <input
                  type="datetime-local"
                  value={form.scheduled_start}
                  onChange={(e) => setForm({ ...form, scheduled_start: e.target.value })}
                  required
                  style={{ width: '100%', padding: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                />
              </div>
              <div>
                <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>End Time (Local)</label>
                <input
                  type="datetime-local"
                  value={form.scheduled_end}
                  onChange={(e) => setForm({ ...form, scheduled_end: e.target.value })}
                  required
                  style={{ width: '100%', padding: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                />
              </div>
            </div>

            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Reason / Work Description</label>
              <input
                type="text"
                placeholder="e.g. Planned jumper replacement and conductor restringing"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                style={{ width: '100%', padding: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
              />
            </div>

            <button type="submit" className="btn btn-sm btn-primary" style={{ width: '100%' }}>
              Save Scheduled Outage
            </button>
          </form>
        )}

        <div className="outage-list" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          {outages.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
              No planned outages scheduled.
            </div>
          ) : (
            outages.map((o) => (
              <div
                key={o.outage_id}
                className="outage-card"
                style={{
                  borderLeft: o.cancelled
                    ? '3px solid #6b7280'
                    : o.is_active
                    ? '3px solid #f59e0b'
                    : '3px solid #3b82f6',
                  opacity: o.cancelled ? 0.6 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: 12 }}>
                    {o.scope.toUpperCase()}: {o.target_id}
                  </span>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {o.cancelled ? (
                      <span className="status-pill" style={{ background: '#374151', color: '#9ca3af' }}>
                        CANCELLED
                      </span>
                    ) : o.is_active ? (
                      <span className="status-pill status-pill-fault">
                        ACTIVE NOW
                      </span>
                    ) : (
                      <span className="status-pill status-pill-healthy">
                        UPCOMING
                      </span>
                    )}
                    {!o.cancelled && (
                      <button
                        className="btn btn-xs btn-secondary"
                        onClick={() => handleCancel(o.outage_id)}
                        title="Cancel Outage"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {o.reason || 'Scheduled maintenance'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  ⏱️ {formatTime(o.scheduled_start)} → {formatTime(o.scheduled_end)} (grace: +30m)
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

export default OutageManagementPanel
