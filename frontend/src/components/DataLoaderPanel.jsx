import { useState, useEffect, useCallback } from 'react'

function DataLoaderPanel({ apiUrl }) {
  const [dataStatus, setDataStatus] = useState(null)
  const [uploadResult, setUploadResult] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [reloading, setReloading] = useState(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/data/status`)
      if (res.ok) {
        const data = await res.json()
        setDataStatus(data)
      }
    } catch (e) {
      // silently ignore
    }
  }, [apiUrl])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  const handleUpload = async (type) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv'
    input.onchange = async (e) => {
      const file = e.target.files[0]
      if (!file) return

      setUploading(true)
      setUploadResult(null)

      const formData = new FormData()
      formData.append('file', file)

      try {
        const res = await fetch(`${apiUrl}/api/data/upload/${type}`, {
          method: 'POST',
          body: formData,
        })
        const data = await res.json()
        setUploadResult(data)
      } catch (err) {
        setUploadResult({ error: err.message })
      }
      setUploading(false)
    }
    input.click()
  }

  const handleReload = async () => {
    setReloading(true)
    try {
      const res = await fetch(`${apiUrl}/api/data/reload`, { method: 'POST' })
      const data = await res.json()
      setUploadResult(data)
      await fetchStatus()
    } catch (err) {
      setUploadResult({ error: err.message })
    }
    setReloading(false)
  }

  return (
    <div className="data-loader-panel">
      <div className="dash-value-header">
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
          📤 Data Management
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
          Upload your pole and DT registries, or manage the seeded demo data
        </p>
      </div>

      {/* Current Data Status */}
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">📋</span>
          <span className="dash-card-title">Current Data Source</span>
          <span className={`dash-health-badge ${dataStatus?.data_source === 'seeded' ? 'dash-health-ok' : 'dash-health-warn'}`}>
            {dataStatus?.data_source === 'seeded' ? '🔵 Demo Data' : '⚪ Empty'}
          </span>
        </div>
        {dataStatus && (
          <div className="dash-stats-grid">
            <div className="dash-stat">
              <div className="dash-stat-value">{dataStatus.total_poles || 0}</div>
              <div className="dash-stat-label">Poles</div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-value">{dataStatus.total_dts || 0}</div>
              <div className="dash-stat-label">Transformers</div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-value">{dataStatus.device_coverage_pct || 0}%</div>
              <div className="dash-stat-label">Device Coverage</div>
            </div>
            <div className="dash-stat">
              <div className="dash-stat-value">{dataStatus.topology_coverage_pct || 0}%</div>
              <div className="dash-stat-label">Topology Coverage</div>
            </div>
          </div>
        )}
        <div className="dash-bar-container">
          <div className="dash-bar-label">
            <span>Graph: {dataStatus?.graph_nodes || 0} nodes, {dataStatus?.graph_edges || 0} edges</span>
            <span style={{ color: dataStatus?.graph_built ? '#10b981' : '#ef4444' }}>
              {dataStatus?.graph_built ? '✓ Built' : '✗ Not built'}
            </span>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">📁</span>
          <span className="dash-card-title">Upload Registry CSV</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          Upload your ESCOM's pole or DT registry CSV to replace demo data.
          The system validates data quality before loading.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleUpload('poles')}
            disabled={uploading}
            style={{ flex: 1 }}
          >
            {uploading ? '⏳ Uploading...' : '📍 Upload Poles CSV'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => handleUpload('dts')}
            disabled={uploading}
            style={{ flex: 1 }}
          >
            {uploading ? '⏳ Uploading...' : '⚡ Upload DTs CSV'}
          </button>
        </div>

        <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>
          <strong>Pole CSV columns:</strong> pole_id, lat, lon, feeder_id, dt_id, parent_pole_id (optional), device_id (optional), pincode (optional)
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>
          <strong>DT CSV columns:</strong> dt_id, feeder_id, lat, lon, capacity_kva (optional), households_served (optional)
        </div>
      </div>

      {/* Reload Network */}
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">🔄</span>
          <span className="dash-card-title">Rebuild Network Topology</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          After uploading new data, rebuild the network graph and restart fault detection.
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={handleReload}
          disabled={reloading}
          style={{ width: '100%' }}
        >
          {reloading ? '⏳ Rebuilding...' : '🔄 Reload Network'}
        </button>
      </div>

      {/* Upload/Reload Result */}
      {uploadResult && (
        <div className="dash-card" style={{
          borderLeft: uploadResult.error ? '3px solid #ef4444' : '3px solid #10b981'
        }}>
          <div className="dash-card-header">
            <span className="dash-card-icon">{uploadResult.error ? '❌' : '✅'}</span>
            <span className="dash-card-title">
              {uploadResult.error ? 'Error' : uploadResult.status === 'reloaded' ? 'Network Reloaded' : 'Validation Result'}
            </span>
          </div>
          {uploadResult.error ? (
            <div style={{ fontSize: 12, color: '#ef4444' }}>{uploadResult.error}</div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              {uploadResult.status === 'validated' && (
                <>
                  <div>📄 File: {uploadResult.filename}</div>
                  <div>✅ Valid rows: {uploadResult.valid_rows}</div>
                  <div>❌ Invalid rows: {uploadResult.invalid_rows}</div>
                  {uploadResult.warnings?.map((w, i) => (
                    <div key={i} style={{ color: '#f59e0b', marginTop: 2 }}>⚠️ {w}</div>
                  ))}
                </>
              )}
              {uploadResult.status === 'reloaded' && (
                <>
                  <div>Poles loaded: {uploadResult.poles}</div>
                  <div>Graph: {uploadResult.graph_nodes} nodes, {uploadResult.graph_edges} edges</div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default DataLoaderPanel
