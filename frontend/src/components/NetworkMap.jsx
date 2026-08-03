import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet'
import { useEffect } from 'react'

const STATUS_COLORS = {
  live: '#22c55e',
  suspected_dark: '#f59e0b',
  confirmed_dark: '#ef4444',
  unknown: '#6b7280',
  device_dead: '#4b5563',
}

const TOPO_COLORS = {
  surveyed: 'rgba(34, 197, 94, 0.4)',
  inferred_gps: 'rgba(245, 158, 11, 0.3)',
  unknown: 'rgba(107, 114, 128, 0.2)',
}

/** Forces Leaflet to recalculate container size after the map becomes visible */
function MapReadyHandler() {
  const map = useMap()
  useEffect(() => {
    // Immediate invalidation
    map.invalidateSize()
    // Delayed invalidation — covers CSS transitions / layout shifts
    const t1 = setTimeout(() => map.invalidateSize(), 100)
    const t2 = setTimeout(() => map.invalidateSize(), 400)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [map])
  return null
}

function FitBounds({ poles }) {
  const map = useMap()
  useEffect(() => {
    if (poles.length > 0) {
      const lats = poles.map(p => p.lat).filter(Boolean)
      const lons = poles.map(p => p.lon).filter(Boolean)
      if (lats.length > 0) {
        map.fitBounds([
          [Math.min(...lats) - 0.002, Math.min(...lons) - 0.002],
          [Math.max(...lats) + 0.002, Math.max(...lons) + 0.002],
        ])
      }
    }
  }, [poles, map])
  return null
}

function NetworkMap({ poles, dts, edges, tickets, selectedTicket, onPoleClick }) {
  const center = poles.length > 0
    ? [poles.reduce((s, p) => s + (p.lat || 0), 0) / poles.length,
       poles.reduce((s, p) => s + (p.lon || 0), 0) / poles.length]
    : [12.9716, 77.5946]

  // Highlight affected poles for selected ticket
  const affectedPoles = new Set(selectedTicket?.affected_poles || [])

  return (
    <MapContainer center={center} zoom={15} preferCanvas={true} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
      />
      <FitBounds poles={poles} />
      <MapReadyHandler />

      {/* Network edges (pole-to-pole spans) */}
      {edges.map((edge, i) => (
        <Polyline
          key={`edge-${i}`}
          positions={[
            [edge.from_lat, edge.from_lon],
            [edge.to_lat, edge.to_lon],
          ]}
          pathOptions={{
            color: TOPO_COLORS[edge.topology_source] || TOPO_COLORS.unknown,
            weight: edge.topology_source === 'surveyed' ? 2 : 1.5,
            dashArray: edge.topology_source === 'inferred_gps' ? '5 5' : null,
          }}
        />
      ))}

      {/* DT markers */}
      {dts.map(dt => (
        <CircleMarker
          key={dt.dt_id}
          center={[dt.lat, dt.lon]}
          radius={7}
          pathOptions={{
            fillColor: '#3b82f6',
            fillOpacity: 0.8,
            color: '#1e40af',
            weight: 2,
          }}
        >
          <Popup>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
              <strong>{dt.dt_id}</strong><br />
              Feeder: {dt.feeder_id}<br />
              Households: {dt.households_served}<br />
              Topology: {dt.has_surveyed_topology ? '✅ Surveyed' : '⚠️ Inferred'}
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {/* Pole markers */}
      {poles.map(pole => {
        const isAffected = affectedPoles.has(pole.pole_id)
        const isBoundary = selectedTicket && (
          pole.pole_id === selectedTicket.boundary_live_pole ||
          pole.pole_id === selectedTicket.boundary_dark_pole
        )

        return (
          <CircleMarker
            key={pole.pole_id}
            center={[pole.lat, pole.lon]}
            radius={isBoundary ? 8 : isAffected ? 5 : 3}
            pathOptions={{
              fillColor: isBoundary ? '#f59e0b' : STATUS_COLORS[pole.status] || STATUS_COLORS.unknown,
              fillOpacity: isAffected ? 0.9 : 0.6,
              color: isBoundary ? '#fbbf24' : isAffected ? '#ef4444' : 'transparent',
              weight: isBoundary ? 3 : isAffected ? 2 : 0,
            }}
            eventHandlers={{
              click: () => onPoleClick && onPoleClick(pole),
            }}
          >
            <Popup>
              <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
                <strong>{pole.pole_id}</strong><br />
                Status: <span style={{ color: STATUS_COLORS[pole.status] }}>{pole.status}</span><br />
                DT: {pole.dt_id}<br />
                Device: {pole.has_device ? pole.device_id : '❌ No device'}<br />
                Topology: {pole.topology_source}<br />
                PIN: {pole.pincode || 'Unknown'}
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {/* Fault markers for active tickets */}
      {tickets.filter(t => t.fault_lat && t.fault_lon).map(ticket => (
        <CircleMarker
          key={`fault-${ticket.display_id}`}
          center={[ticket.fault_lat, ticket.fault_lon]}
          radius={12}
          pathOptions={{
            fillColor: '#ef4444',
            fillOpacity: 0.3,
            color: '#ef4444',
            weight: 2,
            dashArray: '3 3',
          }}
        >
          <Popup>
            <div style={{ fontFamily: 'Inter, sans-serif', fontSize: 12 }}>
              <strong>⚡ {ticket.display_id}</strong><br />
              Type: {ticket.fault_type}<br />
              Status: {ticket.status}<br />
              Confidence: {ticket.confidence_label}<br />
              Affected: {ticket.affected_pole_count} poles<br />
              PIN: {ticket.pincode || 'Unknown'}
            </div>
          </Popup>
        </CircleMarker>
      ))}

      {/* Map legend */}
      <div className="map-legend">
        <div className="legend-item">
          <div className="legend-dot" style={{ background: STATUS_COLORS.live }} />
          <span>Live Pole</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: STATUS_COLORS.confirmed_dark }} />
          <span>Dark Pole</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: STATUS_COLORS.suspected_dark }} />
          <span>Suspected Dark</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#3b82f6' }} />
          <span>Transformer (DT)</span>
        </div>
        <div className="legend-item">
          <div className="legend-dot" style={{ background: '#ef4444', opacity: 0.5 }} />
          <span>Fault Location</span>
        </div>
        <div className="legend-item" style={{ marginTop: 6, fontSize: 10, color: '#9ca3b4' }}>
          ── Surveyed │ - - Inferred
        </div>
      </div>
    </MapContainer>
  )
}

export default NetworkMap
