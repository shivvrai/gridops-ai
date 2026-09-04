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
          <span className="dash-card-title">Upload & Template Registry CSV</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
          Upload your DISCOM/ESCOM pole or DT registry CSV to populate real infrastructure.
          The system validates data quality and automatically updates the database.
        </div>

        {/* Template Downloads */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <a
            href={`${apiUrl}/api/data/template/poles`}
            download="poles_template.csv"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            📥 Download Poles Template
          </a>
          <a
            href={`${apiUrl}/api/data/template/dts`}
            download="dts_template.csv"
            className="btn btn-secondary btn-sm"
            style={{ flex: 1, textAlign: 'center', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
          >
            📥 Download DTs Template
          </a>
        </div>

        {/* Upload Buttons */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
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

        {/* Column Reference Specs */}
        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: 6, padding: '8px 10px', marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            📍 Poles CSV Data Columns:
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <span style={{ color: '#ef4444', fontWeight: 600 }}>Required:</span> <code>pole_id</code>, <code>lat</code>, <code>lon</code>, <code>feeder_id</code>, <code>dt_id</code><br />
            <span style={{ color: '#10b981', fontWeight: 600 }}>Optional:</span> <code>parent_pole_id</code> (for surveyed order), <code>seq_on_line</code> (1, 2, 3...), <code>device_id</code> (IoT sensor ID), <code>ward</code>, <code>pincode</code>, <code>pole_type</code> (e.g. LT-9m-PCC)
          </div>
        </div>

        <div style={{ background: 'rgba(255, 255, 255, 0.03)', borderRadius: 6, padding: '8px 10px', marginTop: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
            ⚡ DT (Transformers) CSV Data Columns:
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            <span style={{ color: '#ef4444', fontWeight: 600 }}>Required:</span> <code>dt_id</code>, <code>feeder_id</code>, <code>lat</code>, <code>lon</code><br />
            <span style={{ color: '#10b981', fontWeight: 600 }}>Optional:</span> <code>capacity_kva</code> (e.g. 250), <code>households_served</code> (e.g. 318), <code>has_surveyed_topology</code> (true/false)
          </div>
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
                  {uploadResult.saved_to_db > 0 && (
                    <div style={{ color: '#10b981', fontWeight: 600, marginTop: 4 }}>
                      💾 Saved {uploadResult.saved_to_db} records to database
                    </div>
                  )}
                  {uploadResult.next_step && (
                    <div style={{ color: 'var(--text-primary)', marginTop: 4, fontWeight: 500 }}>
                      👉 {uploadResult.next_step}
                    </div>
                  )}
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
