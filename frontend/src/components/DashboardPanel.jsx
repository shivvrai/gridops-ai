import { useState, useEffect, useCallback } from 'react'

function DashboardPanel({ apiUrl }) {
  const [overview, setOverview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/analytics/overview`)
      if (res.ok) {
        const data = await res.json()
        setOverview(data)
        setError(null)
      }
    } catch (e) {
      setError('Failed to fetch analytics')
    }
    setLoading(false)
  }, [apiUrl])

  useEffect(() => {
    fetchOverview()
    const interval = setInterval(fetchOverview, 15000) // Refresh every 15s
    return () => clearInterval(interval)
  }, [fetchOverview])

  if (loading) {
    return (
      <div className="dashboard-panel">
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          ⏳ Loading dashboard...
        </div>
      </div>
    )
  }

  if (error || !overview) {
    return (
      <div className="dashboard-panel">
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
          ⚠️ {error || 'No data available'}
        </div>
      </div>
    )
  }

  const nh = overview.network_health || {}
  const rel = overview.reliability || {}

  return (
    <div className="dashboard-panel">
      {/* Value Proposition Header */}
      <div className="dash-value-header">
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          ⚡ GridOps AI — Control Room Dashboard
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          Automated fault detection replacing manual 2-hour pole-by-pole inspection
        </p>
      </div>

      {/* Network Health Card */}
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">🏗️</span>
          <span className="dash-card-title">Network Health</span>
          <span className={`dash-health-badge ${nh.dark_poles > 0 ? 'dash-health-warn' : 'dash-health-ok'}`}>
            {nh.dark_poles > 0 ? `${nh.dark_poles} dark` : '✓ All clear'}
          </span>
        </div>
        <div className="dash-stats-grid">
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#10b981' }}>{nh.live_poles || 0}</div>
            <div className="dash-stat-label">Live Poles</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#ef4444' }}>{nh.dark_poles || 0}</div>
            <div className="dash-stat-label">Dark Poles</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value">{nh.total_poles || 0}</div>
            <div className="dash-stat-label">Total Poles</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value">{nh.device_coverage_pct || 0}%</div>
            <div className="dash-stat-label">Device Coverage</div>
          </div>
        </div>
        <div className="dash-bar-container">
          <div className="dash-bar-label">
            <span>Topology: {nh.surveyed_dts || 0}/{nh.total_dts || 0} DTs surveyed ({nh.topology_surveyed_pct || 0}%)</span>
          </div>
          <div className="dash-bar-track">
            <div className="dash-bar-fill" style={{ width: `${nh.topology_surveyed_pct || 0}%` }} />
          </div>
        </div>
      </div>

      {/* Performance Card */}
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">⚡</span>
          <span className="dash-card-title">Detection Performance</span>
        </div>
        <div className="dash-stats-grid">
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#3b82f6' }}>~{overview.avg_detection_seconds || '—'}s</div>
            <div className="dash-stat-label">Avg Detection</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#8b5cf6' }}>
              {overview.avg_resolution_minutes ? `${overview.avg_resolution_minutes}m` : '—'}
            </div>
            <div className="dash-stat-label">Avg Resolution</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#10b981' }}>
              {overview.time_saved_hours ? `${overview.time_saved_hours}h` : '0h'}
            </div>
            <div className="dash-stat-label">Time Saved</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value">{overview.active_faults || 0}</div>
            <div className="dash-stat-label">Active Faults</div>
          </div>
        </div>
        <div style={{ background: 'rgba(59, 130, 246, 0.06)', padding: '8px 10px', borderRadius: 6, fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
          💡 <strong>Before this system:</strong> Average 2 hours per fault (lineman walks pole-by-pole).
          <strong> After:</strong> ~{overview.avg_detection_seconds || 35}s automated detection with GPS coordinates.
        </div>
      </div>

      {/* Reliability Metrics (SAIDI/SAIFI/CAIDI) */}
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">📊</span>
          <span className="dash-card-title">Reliability Indices (SERC Standard)</span>
        </div>
        <div className="dash-stats-grid">
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#f59e0b' }}>{rel.saifi || 0}</div>
            <div className="dash-stat-label">SAIFI</div>
            <div className="dash-stat-sub">Interruptions/customer</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#f59e0b' }}>{rel.saidi || 0}</div>
            <div className="dash-stat-label">SAIDI</div>
            <div className="dash-stat-sub">Min outage/customer</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value" style={{ color: '#f59e0b' }}>{rel.caidi || 0}</div>
            <div className="dash-stat-label">CAIDI</div>
            <div className="dash-stat-sub">Avg min/interruption</div>
          </div>
          <div className="dash-stat">
            <div className="dash-stat-value">{overview.total_tickets || 0}</div>
            <div className="dash-stat-label">Total Tickets</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6, fontStyle: 'italic' }}>
          Metrics computed per CERC/SERC standards. SAIFI = System Average Interruption Frequency Index.
        </div>
      </div>

      {/* How It Works — for non-technical operators */}
      <div className="dash-card dash-card-info">
        <div className="dash-card-header">
          <span className="dash-card-icon">📘</span>
          <span className="dash-card-title">How This System Works</span>
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: 6 }}>
            <strong>1. Detect</strong> — IoT devices on {nh.device_coverage_pct || 91}% of poles report
            power status every 15 minutes. When power is lost, devices send an instant alert.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>2. Localize</strong> — The system walks the network tree to find the exact
            live→dark boundary (the span where the wire broke), within ~{overview.avg_detection_seconds || 35} seconds.
          </div>
          <div style={{ marginBottom: 6 }}>
            <strong>3. Ticket</strong> — A ticket is created with GPS coordinates, affected pole count,
            estimated households impacted, and distance metrics for crew dispatch.
          </div>
          <div>
            <strong>4. Verify</strong> — When the crew repairs the fault, the system auto-verifies
            restoration when all affected poles report power restored.
          </div>
        </div>
      </div>
    </div>
  )
}

export default DashboardPanel
