import { useMemo } from 'react'

function FeederView({
  selectedFeederId,
  poles = [],
  dts = [],
  tickets = [],
  onSelectFeeder,
  onViewFeederMap,
  onViewIncidents,
}) {
  // Aggregate stats for the selected feeder
  const stats = useMemo(() => {
    if (!selectedFeederId) return null

    const feederPoles = poles.filter((p) => p.feeder_id === selectedFeederId)
    const feederDts = dts.filter((d) => d.feeder_id === selectedFeederId)
    const feederTickets = tickets.filter((t) => t.feeder_id === selectedFeederId)
    const devicesCount = feederPoles.filter((p) => p.has_device || p.device_id).length
    const darkPolesCount = feederPoles.filter((p) =>
      ['confirmed_dark', 'suspected_dark'].includes(p.status)
    ).length

    const status = feederTickets.length > 0 ? 'DEGRADED' : 'HEALTHY'

    return {
      feederId: selectedFeederId,
      status,
      poleCount: feederPoles.length,
      dtCount: feederDts.length,
      deviceCount: devicesCount,
      deviceCoveragePct: feederPoles.length > 0
        ? Math.round((devicesCount / feederPoles.length) * 100)
        : 0,
      activeIncidents: feederTickets.length,
      darkPolesCount,
      affectedDTs: [...new Set(feederTickets.map((t) => t.dt_id).filter(Boolean))],
    }
  }, [selectedFeederId, poles, dts, tickets])

  if (!stats) return null

  return (
    <div className="feeder-view-card">
      <div className="feeder-view-header">
        <div>
          <span className="feeder-badge">⚡ 11 kV FEEDER</span>
          <h3 style={{ margin: '4px 0 0' }}>{stats.feederId}</h3>
        </div>
        <span
          className={`status-pill ${
            stats.status === 'HEALTHY' ? 'status-pill-healthy' : 'status-pill-fault'
          }`}
        >
          {stats.status}
        </span>
      </div>

      <div className="feeder-stats-grid">
        <div className="feeder-stat">
          <div className="val">{stats.dtCount}</div>
          <div className="lbl">Transformers</div>
        </div>
        <div className="feeder-stat">
          <div className="val">{stats.poleCount}</div>
          <div className="lbl">LT Poles</div>
        </div>
        <div className="feeder-stat">
          <div className="val">{stats.deviceCoveragePct}%</div>
          <div className="lbl">Telemetry ({stats.deviceCount})</div>
        </div>
        <div className="feeder-stat">
          <div className="val" style={{ color: stats.activeIncidents > 0 ? '#ef4444' : '#10b981' }}>
            {stats.activeIncidents}
          </div>
          <div className="lbl">Active Faults</div>
        </div>
      </div>

      {stats.affectedDTs.length > 0 && (
        <div className="feeder-affected-box">
          <strong>Affected Sub-Grid:</strong>
          <div>Transformers: {stats.affectedDTs.join(', ')}</div>
          <div>Dark Poles: {stats.darkPolesCount} downstream poles de-energized</div>
        </div>
      )}

      <div className="feeder-actions">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => onViewFeederMap && onViewFeederMap(stats.feederId)}
        >
          🗺️ View Feeder Map
        </button>
        <button
          type="button"
          className="btn btn-sm btn-secondary"
          onClick={() => onViewIncidents && onViewIncidents(stats.feederId)}
        >
          🎫 View Incidents ({stats.activeIncidents})
        </button>
      </div>
    </div>
  )
}

export default FeederView
