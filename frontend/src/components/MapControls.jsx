import { useState } from 'react'

function MapControls({
  layers,
  onToggleLayer,
  filters,
  onChangeFilter,
  feeders = [],
  dts = [],
  onSearch,
  onResetView,
  onZoomToIncident,
  selectedTicket,
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [panelOpen, setPanelOpen] = useState(false)

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    if (onSearch) onSearch(searchQuery.trim())
  }

  return (
    <div className="map-controls-wrapper">
      {/* Top Bar: Search + Quick Tools */}
      <div className="map-top-bar">
        <form onSubmit={handleSearchSubmit} className="map-search-form">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="map-search-input"
            placeholder="Search Pole (e.g. P-0012), DT, Feeder, or Ticket..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (onSearch) onSearch(e.target.value.trim())
            }}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear"
              onClick={() => {
                setSearchQuery('')
                if (onSearch) onSearch('')
              }}
            >
              ✕
            </button>
          )}
        </form>

        <div className="map-quick-actions">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={onResetView}
            title="Fit Entire Grid to View"
          >
            🎯 Fit Network
          </button>
          {selectedTicket && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={onZoomToIncident}
              title="Focus on Selected Fault"
            >
              ⚡ Zoom Incident
            </button>
          )}
          <button
            type="button"
            className={`btn btn-sm ${panelOpen ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setPanelOpen(!panelOpen)}
          >
            🎛️ Layers & Filters {panelOpen ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Expandable Layers & Filters Drawer */}
      {panelOpen && (
        <div className="map-controls-panel">
          {/* Layer Visibility Toggles */}
          <div className="controls-section">
            <div className="controls-title">Grid Layers</div>
            <div className="layers-grid">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.poles}
                  onChange={() => onToggleLayer('poles')}
                />
                <span>📍 Poles</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.transformers}
                  onChange={() => onToggleLayer('transformers')}
                />
                <span>⚡ Transformers (DT)</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.topology}
                  onChange={() => onToggleLayer('topology')}
                />
                <span>🔗 Topology Lines</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.feeders}
                  onChange={() => onToggleLayer('feeders')}
                />
                <span>🟣 11 kV Feeders</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.faults}
                  onChange={() => onToggleLayer('faults')}
                />
                <span>🔴 Fault Boundaries</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.devices}
                  onChange={() => onToggleLayer('devices')}
                />
                <span>📡 Telemetry Devices</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.outages}
                  onChange={() => onToggleLayer('outages')}
                />
                <span>📅 Planned Outages</span>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={layers.crews}
                  onChange={() => onToggleLayer('crews')}
                />
                <span>👷 Crew Dispatches</span>
              </label>
            </div>
          </div>

          {/* Grid Filters */}
          <div className="controls-section">
            <div className="controls-title">Operational Filters</div>
            <div className="filters-grid">
              <div className="filter-group">
                <label>Feeder</label>
                <select
                  value={filters.feeder || ''}
                  onChange={(e) => onChangeFilter('feeder', e.target.value)}
                >
                  <option value="">All Feeders</option>
                  {feeders.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Transformer (DT)</label>
                <select
                  value={filters.dt || ''}
                  onChange={(e) => onChangeFilter('dt', e.target.value)}
                >
                  <option value="">All DTs</option>
                  {dts.map((d) => (
                    <option key={d.dt_id || d} value={d.dt_id || d}>
                      {d.dt_id || d}
                    </option>
                  ))}
                </select>
              </div>

              <div className="filter-group">
                <label>Pole Status</label>
                <select
                  value={filters.poleStatus || ''}
                  onChange={(e) => onChangeFilter('poleStatus', e.target.value)}
                >
                  <option value="">All States</option>
                  <option value="live">🟢 Live Only</option>
                  <option value="confirmed_dark">🔴 Dark (Faulted)</option>
                  <option value="suspected_dark">🟡 Suspected Dark</option>
                  <option value="unknown">⚪ Unknown</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Confidence</label>
                <select
                  value={filters.confidence || ''}
                  onChange={(e) => onChangeFilter('confidence', e.target.value)}
                >
                  <option value="">All Confidences</option>
                  <option value="HIGH">HIGH (Instrumented Boundary)</option>
                  <option value="MEDIUM">MEDIUM (Span Range)</option>
                  <option value="LOW">LOW (Inferred Line)</option>
                </select>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                onChangeFilter('feeder', '')
                onChangeFilter('dt', '')
                onChangeFilter('poleStatus', '')
                onChangeFilter('confidence', '')
              }}
            >
              Reset Filters
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default MapControls
