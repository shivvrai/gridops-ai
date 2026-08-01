import { useState } from 'react'

const TRANSITIONS = {
  detected: { next: 'acknowledged', label: 'Acknowledge', icon: '👁️' },
  acknowledged: { next: 'crew_assigned', label: 'Assign Crew', icon: '👷' },
  crew_assigned: { next: 'resolved', label: 'Mark Resolved', icon: '✅' },
  verified: { next: 'closed', label: 'Close Ticket', icon: '📁' },
}

function TicketDetail({ ticket, onClose, onTransition, onExplain }) {
  const [explanation, setExplanation] = useState(null)
  const [explaining, setExplaining] = useState(false)
  const [transitioning, setTransitioning] = useState(false)

  const transition = TRANSITIONS[ticket.status]

  const handleTransition = async () => {
    if (!transition) return
    setTransitioning(true)
    await onTransition(ticket.display_id, transition.next)
    setTransitioning(false)
  }

  const handleExplain = async () => {
    setExplaining(true)
    const result = await onExplain(ticket.display_id)
    setExplanation(result)
    setExplaining(false)
  }

  const formatTimestamp = (iso) => {
    if (!iso) return '—'
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  }

  return (
    <div className="ticket-detail">
      <div className="detail-header">
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>{ticket.display_id}</h2>
          <span className={`ticket-badge badge-${ticket.status}`} style={{ marginTop: 4, display: 'inline-block' }}>
            {ticket.status}
          </span>
        </div>
        <button className="detail-close" onClick={onClose}>✕</button>
      </div>

      {/* Fault Info */}
      <div className="detail-section">
        <h3>Fault Information</h3>
        <div className="detail-row">
          <span className="label">Type</span>
          <span className="value">{ticket.fault_type === 'span' ? '🔌 Span Fault' : ticket.fault_type === 'dt' ? '⚡ DT Fault' : '🔴 Feeder Fault'}</span>
        </div>
        <div className="detail-row">
          <span className="label">Feeder</span>
          <span className="value">{ticket.feeder_id}</span>
        </div>
        {ticket.dt_id && (
          <div className="detail-row">
            <span className="label">Transformer</span>
            <span className="value">{ticket.dt_id}</span>
          </div>
        )}
        {ticket.boundary_live_pole && (
          <div className="detail-row">
            <span className="label">Boundary</span>
            <span className="value" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              {ticket.boundary_live_pole} → {ticket.boundary_dark_pole}
            </span>
          </div>
        )}
        {ticket.is_range && (
          <div style={{ background: 'rgba(245, 158, 11, 0.1)', padding: '8px 12px', borderRadius: 6, fontSize: 12, color: '#f59e0b', marginTop: 8 }}>
            ⚠️ {ticket.range_description || 'Fault location is a range (uninstrumented poles in gap)'}
          </div>
        )}
      </div>

      {/* Location */}
      <div className="detail-section">
        <h3>Location</h3>
        <div className="detail-row">
          <span className="label">Coordinates</span>
          <span className="value" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
            {ticket.fault_lat?.toFixed(6)}°N, {ticket.fault_lon?.toFixed(6)}°E
          </span>
        </div>
        <div className="detail-row">
          <span className="label">PIN Code</span>
          <span className="value">{ticket.pincode || 'Unknown'}</span>
        </div>
      </div>

      {/* Impact */}
      <div className="detail-section">
        <h3>Impact</h3>
        <div className="detail-row">
          <span className="label">Affected Poles</span>
          <span className="value">{ticket.affected_pole_count}</span>
        </div>
        <div className="detail-row">
          <span className="label">Est. Households</span>
          <span className="value">~{ticket.estimated_households || 'Unknown'}</span>
        </div>
      </div>

      {/* Confidence */}
      <div className="detail-section">
        <h3>Confidence</h3>
        <div className="detail-row">
          <span className="label">Level</span>
          <span className={`confidence-badge confidence-${ticket.confidence_label}`}>
            {ticket.confidence_label}
          </span>
        </div>
        <div className="detail-row">
          <span className="label">Topology</span>
          <span className="value">{ticket.topology_source === 'surveyed' ? '✅ Surveyed' : '⚠️ Inferred (GPS)'}</span>
        </div>
        {ticket.confidence_factors && (
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-card)', padding: 8, borderRadius: 4 }}>
            {Object.entries(ticket.confidence_factors).map(([k, v]) => (
              <div key={k}>{k}: {String(v)}</div>
            ))}
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="detail-section">
        <h3>Timeline</h3>
        <div className="detail-row"><span className="label">Detected</span><span className="value">{formatTimestamp(ticket.detected_at)}</span></div>
        <div className="detail-row"><span className="label">Acknowledged</span><span className="value">{formatTimestamp(ticket.acknowledged_at)}</span></div>
        <div className="detail-row"><span className="label">Crew Assigned</span><span className="value">{formatTimestamp(ticket.crew_assigned_at)}</span></div>
        <div className="detail-row"><span className="label">Resolved</span><span className="value">{formatTimestamp(ticket.resolved_at)}</span></div>
        <div className="detail-row"><span className="label">Verified</span><span className="value">{formatTimestamp(ticket.verified_at)}</span></div>
        <div className="detail-row"><span className="label">Closed</span><span className="value">{formatTimestamp(ticket.closed_at)}</span></div>
      </div>

      {/* Actions */}
      <div className="action-buttons">
        {transition && (
          <button
            className="btn btn-primary"
            onClick={handleTransition}
            disabled={transitioning}
          >
            {transitioning ? '...' : `${transition.icon} ${transition.label}`}
          </button>
        )}

        <button
          className="btn btn-secondary"
          onClick={handleExplain}
          disabled={explaining}
        >
          {explaining ? '🔄 Generating...' : '🤖 Explain This Ticket'}
        </button>
      </div>

      {/* AI Explanation */}
      {explanation && (
        <div className="ai-explanation">
          <div className="ai-header">
            {explanation.source === 'ai' ? '🤖 AI Explanation' : '📋 Structured Summary'}
          </div>
          <div className="ai-text">{explanation.explanation}</div>
          {explanation.note && (
            <div className="ai-fallback">{explanation.note}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default TicketDetail
