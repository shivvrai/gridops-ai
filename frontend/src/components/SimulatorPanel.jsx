import { useState } from 'react'

function SimulatorPanel({ networkInfo, apiUrl, onEvent, onRefresh }) {
  const [selectedDT, setSelectedDT] = useState('')
  const [selectedFeeder, setSelectedFeeder] = useState('')
  const [selectedPole, setSelectedPole] = useState('')
  const [lastResult, setLastResult] = useState(null)
  const [loading, setLoading] = useState(false)

  // Flatten DTs and feeders from hierarchy
  const allDTs = networkInfo?.hierarchy?.flatMap(sub =>
    sub.feeders.flatMap(f => f.dts.map(dt => ({ ...dt, feeder_id: f.feeder_id })))
  ) || []

  const allFeeders = networkInfo?.hierarchy?.flatMap(sub =>
    sub.feeders.map(f => ({ feeder_id: f.feeder_id, dt_count: f.dt_count }))
  ) || []

  const doAction = async (url, body = {}) => {
    setLoading(true)
    setLastResult(null)
    try {
      const res = await fetch(`${apiUrl}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      setLastResult(data)
      if (res.ok) {
        onEvent('✅ Simulator', JSON.stringify(data.status || data.note || 'Done'), 'success')
      } else {
        onEvent('❌ Error', data.detail || 'Failed', 'fault')
      }
      // Refresh data after a delay to let the sweep run
      setTimeout(onRefresh, 2000)
    } catch (err) {
      setLastResult({ error: err.message })
      onEvent('❌ Error', err.message, 'fault')
    }
    setLoading(false)
  }

  return (
    <div className="simulator-panel">
      {/* Span Fault */}
      <div className="sim-section">
        <h3>🔌 Inject Span Fault</h3>
        <select
          className="sim-select"
          value={selectedDT}
          onChange={e => setSelectedDT(e.target.value)}
        >
          <option value="">Select a DT...</option>
          {allDTs.slice(0, 50).map(dt => (
            <option key={dt.dt_id} value={dt.dt_id}>
              {dt.dt_id} — {dt.pole_count} poles {dt.has_surveyed_topology ? '(surveyed)' : '(inferred)'}
            </option>
          ))}
        </select>
        <button
          className="btn btn-danger btn-sm"
          disabled={!selectedDT || loading}
          onClick={() => doAction('/api/simulator/fault/span', { dt_id: selectedDT })}
        >
          {loading ? '...' : '⚡ Inject Span Fault'}
        </button>
      </div>

      {/* DT Fault */}
      <div className="sim-section">
        <h3>⚡ Inject DT Fault</h3>
        <select
          className="sim-select"
          value={selectedDT}
          onChange={e => setSelectedDT(e.target.value)}
        >
          <option value="">Select a DT...</option>
          {allDTs.slice(0, 50).map(dt => (
            <option key={dt.dt_id} value={dt.dt_id}>
              {dt.dt_id} — {dt.pole_count} poles
            </option>
          ))}
        </select>
        <button
          className="btn btn-danger btn-sm"
          disabled={!selectedDT || loading}
          onClick={() => doAction('/api/simulator/fault/dt', { dt_id: selectedDT })}
        >
          {loading ? '...' : '⚡ Inject DT Fault'}
        </button>
      </div>

      {/* Feeder Fault */}
      <div className="sim-section">
        <h3>🔴 Inject Feeder Fault</h3>
        <select
          className="sim-select"
          value={selectedFeeder}
          onChange={e => setSelectedFeeder(e.target.value)}
        >
          <option value="">Select a Feeder...</option>
          {allFeeders.map(f => (
            <option key={f.feeder_id} value={f.feeder_id}>
              {f.feeder_id} — {f.dt_count} DTs
            </option>
          ))}
        </select>
        <button
          className="btn btn-danger btn-sm"
          disabled={!selectedFeeder || loading}
          onClick={() => doAction('/api/simulator/fault/feeder', { feeder_id: selectedFeeder })}
        >
          {loading ? '...' : '🔴 Inject Feeder Fault'}
        </button>
      </div>

      {/* Repair */}
      <div className="sim-section">
        <h3>🔧 Repair Fault</h3>
        <select
          className="sim-select"
          value={selectedDT}
          onChange={e => setSelectedDT(e.target.value)}
        >
          <option value="">Select a DT to repair...</option>
          {allDTs.slice(0, 50).map(dt => (
            <option key={dt.dt_id} value={dt.dt_id}>
              {dt.dt_id} — {dt.pole_count} poles
            </option>
          ))}
        </select>
        <button
          className="btn btn-primary btn-sm"
          disabled={!selectedDT || loading}
          onClick={() => doAction('/api/simulator/repair', { dt_id: selectedDT })}
        >
          {loading ? '...' : '🔧 Repair'}
        </button>
      </div>

      {/* Device Death */}
      <div className="sim-section">
        <h3>💀 Kill Device (no fault)</h3>
        <input
          className="sim-select"
          type="text"
          placeholder="Pole ID (e.g., P-000042)"
          value={selectedPole}
          onChange={e => setSelectedPole(e.target.value)}
        />
        <button
          className="btn btn-secondary btn-sm"
          disabled={!selectedPole || loading}
          onClick={() => doAction('/api/simulator/device/death', { pole_id: selectedPole })}
        >
          {loading ? '...' : '💀 Kill Device'}
        </button>
      </div>

      {/* Result */}
      {lastResult && (
        <div className="sim-result">
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </div>
      )}

      {/* Network Stats */}
      {networkInfo && (
        <div style={{ marginTop: 24, padding: 12, background: 'var(--bg-card)', borderRadius: 8, fontSize: 11, color: 'var(--text-secondary)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>Network Summary</div>
          <div>Substations: {networkInfo.substations}</div>
          <div>Feeders: {networkInfo.feeders}</div>
          <div>Transformers: {networkInfo.dts} ({networkInfo.surveyed_dts} surveyed)</div>
          <div>Poles: {networkInfo.poles} ({networkInfo.poles_with_device} with devices)</div>
        </div>
      )}
    </div>
  )
}

export default SimulatorPanel
