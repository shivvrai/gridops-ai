import { useState, useEffect, useCallback } from 'react'

function SimulatorPanel({ networkInfo, apiUrl, onEvent, onRefresh }) {
  const [selectedDT, setSelectedDT] = useState('')
  const [selectedFeeder, setSelectedFeeder] = useState('')
  const [selectedPole, setSelectedPole] = useState('')
  const [lastResult, setLastResult] = useState(null)
  const [loading, setLoading] = useState(false)

  // Manual repair state
  const [darkPoles, setDarkPoles] = useState([])
  const [loadingFaults, setLoadingFaults] = useState(false)
  const [repairingPole, setRepairingPole] = useState(null)
  const [manualOpen, setManualOpen] = useState(false)

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
      setTimeout(onRefresh, 2000)
    } catch (err) {
      setLastResult({ error: err.message })
      onEvent('❌ Error', err.message, 'fault')
    }
    setLoading(false)
  }

  const fetchDarkPoles = useCallback(async () => {
    setLoadingFaults(true)
    try {
      const res = await fetch(`${apiUrl}/api/simulator/active-faults`)
      if (res.ok) {
        const data = await res.json()
        setDarkPoles(data)
      }
    } catch (e) {
      // silently ignore
    }
    setLoadingFaults(false)
  }, [apiUrl])

  useEffect(() => {
    if (manualOpen) fetchDarkPoles()
  }, [manualOpen, fetchDarkPoles])

  const repairOnePole = async (poleId) => {
    setRepairingPole(poleId)
    try {
      const res = await fetch(`${apiUrl}/api/simulator/repair/pole`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pole_id: poleId }),
      })
      const data = await res.json()
      if (res.ok && data.status === 'repaired') {
        onEvent('🔧 Repaired', `Pole ${poleId} restored`, 'success')
        // Remove from list immediately for instant feedback
        setDarkPoles(prev => prev.filter(p => p.pole_id !== poleId))
        setTimeout(onRefresh, 2000)
      } else {
        onEvent('❌ Error', data.note || 'Repair failed', 'fault')
      }
    } catch (err) {
      onEvent('❌ Error', err.message, 'fault')
    }
    setRepairingPole(null)
  }

  const repairAllVisible = async () => {
    const toRepair = [...darkPoles]
    for (const pole of toRepair) {
      if (pole.has_device) await repairOnePole(pole.pole_id)
    }
  }

  const statusColor = (s) => s === 'confirmed_dark' ? '#ef4444' : '#f59e0b'
  const statusLabel = (s) => s === 'confirmed_dark' ? '⚫ Confirmed Dark' : '🟡 Suspected Dark'

  return (
    <div className="simulator-panel">

      {/* ── Manual Pole Repair ── */}
      <div className="sim-section">
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setManualOpen(o => !o)}
        >
          <h3 style={{ margin: 0 }}>🔧 Manual Pole Repair</h3>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{manualOpen ? '▲ Hide' : '▼ Show'}</span>
        </div>

        {manualOpen && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={fetchDarkPoles}
                disabled={loadingFaults}
                style={{ flex: 1 }}
              >
                {loadingFaults ? '⏳ Loading...' : '🔄 Refresh List'}
              </button>
              {darkPoles.length > 0 && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={repairAllVisible}
                  disabled={repairingPole != null}
                  style={{ flex: 1 }}
                >
                  🔧 Repair All ({darkPoles.length})
                </button>
              )}
            </div>

            {darkPoles.length === 0 && !loadingFaults && (
              <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--text-muted)', fontSize: 12 }}>
                ✅ No dark poles detected
              </div>
            )}

            {darkPoles.length > 0 && (
              <div style={{ maxHeight: 280, overflowY: 'auto', borderRadius: 6, border: '1px solid var(--border-subtle)' }}>
                {darkPoles.map((pole, i) => (
                  <div
                    key={pole.pole_id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 10px',
                      borderBottom: i < darkPoles.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      background: repairingPole === pole.pole_id ? 'rgba(59,130,246,0.06)' : 'transparent',
                      transition: 'background 0.2s',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {pole.pole_id}
                      </div>
                      <div style={{ fontSize: 10, color: statusColor(pole.status), marginTop: 1 }}>
                        {statusLabel(pole.status)}
                        {pole.dt_id && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>· {pole.dt_id}</span>}
                      </div>
                    </div>
                    {pole.has_device ? (
                      <button
                        style={{
                          marginLeft: 8,
                          padding: '4px 10px',
                          fontSize: 11,
                          fontWeight: 600,
                          borderRadius: 5,
                          border: '1px solid rgba(59,130,246,0.4)',
                          background: repairingPole === pole.pole_id ? 'rgba(59,130,246,0.2)' : 'var(--bg-card)',
                          color: '#60a5fa',
                          cursor: repairingPole ? 'not-allowed' : 'pointer',
                          whiteSpace: 'nowrap',
                          opacity: repairingPole && repairingPole !== pole.pole_id ? 0.45 : 1,
                          transition: 'all 0.15s',
                          flexShrink: 0,
                        }}
                        disabled={repairingPole != null}
                        onClick={() => repairOnePole(pole.pole_id)}
                      >
                        {repairingPole === pole.pole_id ? '⏳' : '🔧 Repair'}
                      </button>
                    ) : (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>No device</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--border-subtle)', margin: '4px 0 16px' }} />

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

      {/* Bulk Repair */}
      <div className="sim-section">
        <h3>🔧 Repair All Faults (by DT)</h3>
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
          {loading ? '...' : '🔧 Repair DT'}
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
