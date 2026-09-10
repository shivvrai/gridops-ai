import { useState, useEffect, useCallback } from 'react'

function SystemHealthPanel({ apiUrl, demoData }) {
  const [healthData, setHealthData] = useState(demoData ? {
    overall_status: 'healthy',
    subsystems: {
      database: { latency_ms: 1, poles_in_db: demoData.poles_tracked || 0, tickets_in_db: 3 },
      localization_engine: { poles_tracked: demoData.poles_tracked || 0, graph_nodes: (demoData.poles_tracked || 0) + 6, graph_edges: (demoData.poles_tracked || 0) + 5, sweep_interval_s: 10 },
      telemetry: { total_events_logged: 0 },
      sse_broadcast: { active_subscribers: 1, channel: 'demo-local' },
      simulator: { active_faults_simulated: 2 },
      ai_service: { status: 'healthy', provider: 'Demo Mode (Local)' },
    },
  } : null)
  const [loading, setLoading] = useState(!demoData)
  const [error, setError] = useState(null)

  const fetchHealth = useCallback(async () => {
    if (demoData) return
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/api/system-health`)
      if (res.ok) {
        setHealthData(await res.json())
        setError(null)
      } else {
        throw new Error(`HTTP ${res.status}: Failed to ping health endpoint`)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [apiUrl, demoData])

  useEffect(() => {
    fetchHealth()
    if (demoData) return
    const interval = setInterval(fetchHealth, 10000)
    return () => clearInterval(interval)
  }, [fetchHealth, demoData])

  if (loading && !healthData) {
    return (
      <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
        Pinging core subsystems (API, DB, Engine, Telemetry, SSE, AI)...
      </div>
    )
  }

  if (error) {
    return (
      <div className="dash-card" style={{ borderLeft: '3px solid #ef4444' }}>
        <h4>System Health Alert</h4>
        <div style={{ color: '#ef4444', fontSize: 12 }}>{error}</div>
        <button className="btn btn-xs btn-secondary" onClick={fetchHealth} style={{ marginTop: 8 }}>
          Retry Ping
        </button>
      </div>
    )
  }

  const sub = healthData?.subsystems || {}

  return (
    <div className="system-health-container">
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">🩺</span>
          <span className="dash-card-title">Live System Health & Subsystems</span>
          <span
            className={`status-pill ${
              healthData?.overall_status === 'healthy' ? 'status-pill-healthy' : 'status-pill-fault'
            }`}
          >
            {healthData?.overall_status?.toUpperCase()}
          </span>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 12px' }}>
          Diagnostic telemetry pinged directly from engine and database threads. (Auto-refreshes every 10s)
        </p>

        <div className="health-grid">
          {/* Database */}
          <div className="health-card">
            <div className="health-card-top">
              <span className="health-icon">🗄️</span>
              <span className="health-name">PostgreSQL / SQLite</span>
              <span className="status-dot live" />
            </div>
            <div className="health-stat-line">
              <span>Query Latency:</span>
              <strong>{sub.database?.latency_ms || 0} ms</strong>
            </div>
            <div className="health-stat-line">
              <span>Poles in DB:</span>
              <span>{sub.database?.poles_in_db || 0}</span>
            </div>
            <div className="health-stat-line">
              <span>Tickets in DB:</span>
              <span>{sub.database?.tickets_in_db || 0}</span>
            </div>
          </div>

          {/* Localization Engine */}
          <div className="health-card">
            <div className="health-card-top">
              <span className="health-icon">⚙️</span>
              <span className="health-name">Localization Engine</span>
              <span className="status-dot live" />
            </div>
            <div className="health-stat-line">
              <span>Poles Tracked:</span>
              <strong>{sub.localization_engine?.poles_tracked || 0}</strong>
            </div>
            <div className="health-stat-line">
              <span>Network Graph:</span>
              <span>{sub.localization_engine?.graph_nodes || 0} nodes / {sub.localization_engine?.graph_edges || 0} edges</span>
            </div>
            <div className="health-stat-line">
              <span>Sweep Loop:</span>
              <span>Every {sub.localization_engine?.sweep_interval_s || 10}s</span>
            </div>
          </div>

          {/* Telemetry Stream */}
          <div className="health-card">
            <div className="health-card-top">
              <span className="health-icon">📡</span>
              <span className="health-name">Telemetry Ingest</span>
              <span className="status-dot live" />
            </div>
            <div className="health-stat-line">
              <span>Total Packets:</span>
              <strong>{sub.telemetry?.total_events_logged || 0}</strong>
            </div>
            <div className="health-stat-line">
              <span>Deduplication:</span>
              <span>Active (Seq Monotonic)</span>
            </div>
          </div>

          {/* SSE Push */}
          <div className="health-card">
            <div className="health-card-top">
              <span className="health-icon">⚡</span>
              <span className="health-name">SSE Real-Time Push</span>
              <span className="status-dot live" />
            </div>
            <div className="health-stat-line">
              <span>Active Clients:</span>
              <strong>{sub.sse_broadcast?.active_subscribers || 0} consoles</strong>
            </div>
            <div className="health-stat-line">
              <span>Channel:</span>
              <span>{sub.sse_broadcast?.channel}</span>
            </div>
          </div>

          {/* Simulator */}
          <div className="health-card">
            <div className="health-card-top">
              <span className="health-icon">🔧</span>
              <span className="health-name">Fault Simulator</span>
              <span className="status-dot live" />
            </div>
            <div className="health-stat-line">
              <span>Active Faults:</span>
              <strong>{sub.simulator?.active_faults_simulated || 0}</strong>
            </div>
            <div className="health-stat-line">
              <span>Noise Modeling:</span>
              <span>Packet Loss & Jitter</span>
            </div>
          </div>

          {/* AI Service */}
          <div className="health-card">
            <div className="health-card-top">
              <span className="health-icon">🤖</span>
              <span className="health-name">AI Explainer</span>
              <span className={`status-dot ${sub.ai_service?.status === 'healthy' ? 'live' : 'unknown'}`} />
            </div>
            <div className="health-stat-line">
              <span>Provider:</span>
              <strong>{sub.ai_service?.provider || 'Deterministic'}</strong>
            </div>
            <div className="health-stat-line">
              <span>Authority:</span>
              <span>Read-Only Decision Support</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SystemHealthPanel
