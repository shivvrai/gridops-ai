import { useState, useEffect, useRef } from 'react'

function IncidentInvestigation({
  ticket,
  poles = [],
  onClose,
  onTransition,
  onExplain,
  onReplayStep,
  onAssignCrewClick,
}) {
  const [activeSubTab, setActiveSubTab] = useState('evidence') // 'evidence', 'timeline', 'replay'
  const [explanation, setExplanation] = useState(null)
  const [explaining, setExplaining] = useState(false)
  const [isReplaying, setIsReplaying] = useState(false)
  const [replaySpeed, setReplaySpeed] = useState(1.0)
  const [replayProgress, setReplayProgress] = useState(0)
  const replayTimerRef = useRef(null)

  // Construct telemetry progression timeline based on actual timestamps and state
  const timelineStages = [
    {
      id: 'normal',
      label: 'Normal Operation',
      status: 'completed',
      time: 'Pre-event telemetry healthy',
      detail: 'Periodic heartbeats received within 15-minute window',
    },
    {
      id: 'suspected',
      label: 'Suspected Dark',
      status: 'completed',
      time: ticket.detected_at
        ? new Date(new Date(ticket.detected_at).getTime() - 30000).toLocaleTimeString()
        : 'T - 30s',
      detail: 'Power lost or missed heartbeat detected on downstream pole',
    },
    {
      id: 'confirmed',
      label: 'Confirmed Dark (Corroborated)',
      status: 'completed',
      time: ticket.detected_at ? new Date(ticket.detected_at).toLocaleTimeString() : 'T - 0s',
      detail: `${ticket.affected_pole_count} poles confirmed de-energized via graph corroborate check`,
    },
    {
      id: 'boundary',
      label: 'Boundary Localized',
      status: 'completed',
      time: ticket.detected_at ? new Date(ticket.detected_at).toLocaleTimeString() : 'T - 0s',
      detail: ticket.boundary_live_pole
        ? `Span boundary isolated: Pole ${ticket.boundary_live_pole} (Live) → Pole ${ticket.boundary_dark_pole} (Dark)`
        : `DT-level fault isolated at transformer ${ticket.dt_id}`,
    },
    {
      id: 'incident_created',
      label: 'Incident Ticket Raised',
      status: 'completed',
      time: ticket.detected_at ? new Date(ticket.detected_at).toLocaleTimeString() : '—',
      detail: `Ticket ${ticket.display_id} generated with priority score ${Math.round(ticket.priority_score || 0)}`,
    },
    {
      id: 'crew_assigned',
      label: 'Crew Assigned',
      status: ticket.crew_assigned_at || ticket.status === 'crew_assigned' || ['resolved', 'verified', 'closed'].includes(ticket.status)
        ? 'completed'
        : 'pending',
      time: ticket.crew_assigned_at ? new Date(ticket.crew_assigned_at).toLocaleTimeString() : 'Pending dispatch',
      detail: ticket.assigned_crew_id
        ? `Assigned to ${ticket.assigned_crew_id}`
        : 'Awaiting operator dispatch assignment',
    },
    {
      id: 'resolved',
      label: 'Repair Marked Resolved',
      status: ticket.resolved_at || ['resolved', 'verified', 'closed'].includes(ticket.status)
        ? 'completed'
        : 'pending',
      time: ticket.resolved_at ? new Date(ticket.resolved_at).toLocaleTimeString() : 'Pending field work',
      detail: ticket.field_notes ? `Field notes: ${ticket.field_notes}` : 'Lineman repair in progress',
    },
    {
      id: 'verified',
      label: 'Automated Restoration Verification',
      status: ticket.verified_at || ['verified', 'closed'].includes(ticket.status)
        ? 'completed'
        : 'pending',
      time: ticket.verified_at ? new Date(ticket.verified_at).toLocaleTimeString() : 'Pending re-energization',
      detail: 'Verified automatically when all affected poles report power_restored heartbeats',
    },
  ]

  // Replay Simulator Loop
  useEffect(() => {
    if (isReplaying) {
      const intervalMs = Math.max(200, Math.round(1000 / replaySpeed))
      replayTimerRef.current = setInterval(() => {
        setReplayProgress((prev) => {
          const next = prev + 10
          if (next >= 100) {
            setIsReplaying(false)
            clearInterval(replayTimerRef.current)
            return 100
          }
          return next
        })
      }, intervalMs)
    } else {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current)
    }
    return () => {
      if (replayTimerRef.current) clearInterval(replayTimerRef.current)
    }
  }, [isReplaying, replaySpeed])

  const handleRestartReplay = () => {
    setReplayProgress(0)
    setIsReplaying(true)
  }

  const handleExplain = async () => {
    setExplaining(true)
    const res = await onExplain(ticket.display_id)
    setExplanation(res)
    setExplaining(false)
  }

  return (
    <div className="investigation-drawer">
      {/* Header */}
      <div className="investigation-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="investigation-badge">🔎 INCIDENT INVESTIGATION</span>
            <span className={`ticket-badge badge-${ticket.status}`}>{ticket.status}</span>
            <span className="provenance-badge provenance-inferred">
              {ticket.topology_source === 'surveyed' ? 'SURVEYED' : 'INFERRED TOPOLOGY'}
            </span>
          </div>
          <h2 style={{ margin: '6px 0 2px', fontSize: 18 }}>{ticket.display_id}</h2>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Feeder <strong>{ticket.feeder_id}</strong> · Transformer <strong>{ticket.dt_id || 'N/A'}</strong>
          </div>
        </div>
        <button className="detail-close" onClick={onClose}>✕</button>
      </div>

      {/* Sub-tabs */}
      <div className="investigation-subtabs">
        <button
          className={`subtab-btn ${activeSubTab === 'evidence' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('evidence')}
        >
          📋 Localization Evidence
        </button>
        <button
          className={`subtab-btn ${activeSubTab === 'timeline' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('timeline')}
        >
          ⏱️ Telemetry Timeline
        </button>
        <button
          className={`subtab-btn ${activeSubTab === 'replay' ? 'active' : ''}`}
          onClick={() => setActiveSubTab('replay')}
        >
          ▶️ Incident Replay
        </button>
      </div>

      {/* TAB 1: Evidence & Technical Proof */}
      {activeSubTab === 'evidence' && (
        <div className="investigation-tab-content">
          <div className="evidence-grid">
            <div className="evidence-card">
              <div className="evidence-card-label">Fault Classification</div>
              <div className="evidence-card-value">
                {ticket.fault_type === 'span' ? '🔌 Span Line Snap' : ticket.fault_type === 'dt' ? '⚡ Transformer Outage' : '🔴 Feeder Trip'}
              </div>
              <div className="evidence-card-sub">Confidence: <strong>{ticket.confidence_label}</strong></div>
            </div>

            <div className="evidence-card">
              <div className="evidence-card-label">Isolated Boundary</div>
              <div className="evidence-card-value mono">
                {ticket.boundary_live_pole ? `${ticket.boundary_live_pole} → ${ticket.boundary_dark_pole}` : 'DT Failure'}
              </div>
              <div className="evidence-card-sub">
                {ticket.is_range ? 'Range contains uninstrumented gaps' : 'Exact pole-to-pole span'}
              </div>
            </div>

            <div className="evidence-card">
              <div className="evidence-card-label">Downstream Affected Poles</div>
              <div className="evidence-card-value" style={{ color: '#ef4444' }}>
                {ticket.affected_pole_count} Poles
              </div>
              <div className="evidence-card-sub">~{ticket.estimated_households || 0} Consumer Connections</div>
            </div>

            <div className="evidence-card">
              <div className="evidence-card-label">Distance from Transformer</div>
              <div className="evidence-card-value">
                {ticket.dt_distance_m ? `${Math.round(ticket.dt_distance_m)}m` : '0m'}
              </div>
              <div className="evidence-card-sub">Span length: ~{Math.round(ticket.span_distance_m || 0)}m</div>
            </div>
          </div>

          {/* Navigation & Dispatch Links */}
          {ticket.fault_lat && ticket.fault_lon && (
            <div style={{ marginTop: 12 }}>
              <a
                href={`https://www.google.com/maps?q=${ticket.fault_lat},${ticket.fault_lon}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-nav"
                style={{ width: '100%', justifyContent: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}
              >
                📍 Open Fault Coordinates in Google Maps ({ticket.fault_lat.toFixed(5)}°N, {ticket.fault_lon.toFixed(5)}°E)
              </a>
            </div>
          )}

          {/* AI Explanation Accordion */}
          <div className="ai-section" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <strong style={{ fontSize: 12 }}>🤖 Control Room Natural Language Explanation</strong>
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleExplain}
                disabled={explaining}
              >
                {explaining ? 'Generating...' : 'Explain Incident'}
              </button>
            </div>
            {explanation && (
              <div className="ai-explanation-box">
                <div style={{ fontSize: 11, lineHeight: 1.5 }}>{explanation.explanation}</div>
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 4 }}>
                  Source: {explanation.source} · Read-only decision support
                </div>
              </div>
            )}
          </div>

          {/* Crew Assignment Bar */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-color)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Assigned Crew:</div>
                <div style={{ fontWeight: 600 }}>{ticket.assigned_crew_id || 'None (Unassigned)'}</div>
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={onAssignCrewClick}
              >
                👷 Dispatch Crew
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Telemetry Timeline */}
      {activeSubTab === 'timeline' && (
        <div className="investigation-tab-content">
          <div className="timeline-container">
            {timelineStages.map((stage, idx) => (
              <div key={stage.id} className={`timeline-item ${stage.status}`}>
                <div className="timeline-marker">
                  <div className="marker-dot" />
                  {idx < timelineStages.length - 1 && <div className="marker-line" />}
                </div>
                <div className="timeline-content">
                  <div className="timeline-title-row">
                    <span className="timeline-title">{stage.label}</span>
                    <span className="timeline-time">{stage.time}</span>
                  </div>
                  <div className="timeline-desc">{stage.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Incident Replay Simulator */}
      {activeSubTab === 'replay' && (
        <div className="investigation-tab-content">
          <div className="replay-banner">
            <span className="provenance-badge provenance-simulated">SIMULATED REPLAY</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 8 }}>
              Replaying historical telemetry packets through the localized boundary
            </span>
          </div>

          <div className="replay-controls-card">
            <div className="replay-progress-bar">
              <div
                className="replay-progress-fill"
                style={{ width: `${replayProgress}%` }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              <span>T-0: Heartbeat Active</span>
              <span>T+30s: Outage Confirmed</span>
              <span>Progress: {replayProgress}%</span>
            </div>

            <div className="replay-btn-row" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setIsReplaying(!isReplaying)}
              >
                {isReplaying ? '⏸️ Pause' : '▶️ Play'}
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={handleRestartReplay}
              >
                🔄 Restart
              </button>

              <div style={{ display: 'flex', gap: 4, marginLeft: 'auto', alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Speed:</span>
                {[0.5, 1.0, 2.0, 5.0].map((s) => (
                  <button
                    key={s}
                    className={`btn btn-xs ${replaySpeed === s ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setReplaySpeed(s)}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="replay-step-info">
            <div style={{ fontSize: 11, fontWeight: 600 }}>Replay State:</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              {replayProgress < 30 && '🟢 Telemetry packets arriving with regular 15-minute jitter; all poles energized.'}
              {replayProgress >= 30 && replayProgress < 70 && '⚡ Tree snap injected on span; capacitor dying message received; corroboration window active.'}
              {replayProgress >= 70 && '🔴 Live→Dark boundary isolated at line section; fault boundary locked.'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default IncidentInvestigation
