function TicketList({ tickets, recentTickets, selectedId, onSelect }) {
  if (tickets.length === 0 && recentTickets.length === 0) {
    return (
      <div className="empty-state">
        <div className="icon">✅</div>
        <p>No active faults detected</p>
        <p style={{ fontSize: 11, marginTop: 8, color: 'var(--text-muted)' }}>
          Use the Simulator tab to inject a fault
        </p>
      </div>
    )
  }

  const formatTime = (isoStr) => {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const faultTypeLabel = (type) => {
    switch (type) {
      case 'span': return '🔌 Span'
      case 'dt': return '⚡ Transformer'
      case 'feeder': return '🔴 Feeder'
      default: return type
    }
  }

  return (
    <div>
      {tickets.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px', marginBottom: 4 }}>
            Active Faults ({tickets.length})
          </div>
          {tickets.map(ticket => (
            <div
              key={ticket.display_id}
              className={`ticket-card ${selectedId === ticket.display_id ? 'active' : ''} topo-${ticket.topology_source === 'surveyed' ? 'surveyed' : 'inferred'}`}
              onClick={() => onSelect(ticket)}
            >
              <div className="ticket-header">
                <span className="ticket-id">{ticket.display_id}</span>
                <span className={`ticket-badge badge-${ticket.status}`}>
                  {ticket.status}
                </span>
              </div>
              <div className="ticket-location">
                {faultTypeLabel(ticket.fault_type)}
                {ticket.dt_id && ` on ${ticket.dt_id}`}
                {ticket.pincode && ` • PIN ${ticket.pincode}`}
              </div>
              <div className="ticket-meta">
                <span>
                  <span className={`confidence-badge confidence-${ticket.confidence_label}`}>
                    {ticket.confidence_label}
                  </span>
                </span>
                <span>👥 ~{ticket.estimated_households || '?'} homes</span>
                <span>📍 {ticket.affected_pole_count} poles</span>
                <span>🕐 {formatTime(ticket.detected_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {recentTickets.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 8px', marginBottom: 4 }}>
            Recently Resolved
          </div>
          {recentTickets.map(ticket => (
            <div
              key={ticket.display_id}
              className="ticket-card"
              style={{ opacity: 0.6 }}
              onClick={() => onSelect(ticket)}
            >
              <div className="ticket-header">
                <span className="ticket-id">{ticket.display_id}</span>
                <span className={`ticket-badge badge-${ticket.status}`}>
                  {ticket.status}
                </span>
              </div>
              <div className="ticket-location">
                {faultTypeLabel(ticket.fault_type)}
                {ticket.dt_id && ` on ${ticket.dt_id}`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default TicketList
