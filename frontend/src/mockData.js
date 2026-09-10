/**
 * Mock data for demo mode — used when no backend is available.
 * Generates a realistic power distribution network in-memory.
 */

// ── Demo Users ──────────────────────────────────────────────
export const DEMO_USERS = {
  'admin@gridops.ai': {
    password: 'admin123',
    user: {
      user_id: 'USR-ADMIN-01',
      email: 'admin@gridops.ai',
      full_name: 'System Administrator',
      name: 'System Administrator',
      role: 'ADMIN',
      is_active: true,
    },
  },
  'operator@gridops.ai': {
    password: 'operator123',
    user: {
      user_id: 'USR-OPERATOR-01',
      email: 'operator@gridops.ai',
      full_name: 'Control Room Operator',
      name: 'Control Room Operator',
      role: 'OPERATOR',
      is_active: true,
    },
  },
  'crew@gridops.ai': {
    password: 'crew123',
    user: {
      user_id: 'USR-CREW-01',
      email: 'crew@gridops.ai',
      full_name: 'Rajesh Kumar (Field Lead)',
      name: 'Rajesh Kumar (Field Lead)',
      role: 'FIELD_CREW',
      is_active: true,
    },
  },
}

// ── Network Generation ──────────────────────────────────────
// Bangalore-area coordinates
const BASE_LAT = 12.9716
const BASE_LON = 77.5946

function generatePoleId(dtIdx, poleIdx) {
  return `P-${String(dtIdx).padStart(2, '0')}-${String(poleIdx).padStart(3, '0')}`
}

function generateDeviceId(dtIdx, poleIdx) {
  return `DEV-${String(dtIdx).padStart(2, '0')}-${String(poleIdx).padStart(3, '0')}`
}

// Generate the full network
function generateNetwork() {
  const substations = [
    { substation_id: 'SUB-01', lat: BASE_LAT, lon: BASE_LON, name: 'Koramangala Substation' },
  ]

  const feeders = [
    { feeder_id: 'F-01-01', substation_id: 'SUB-01', name: 'Feeder North' },
    { feeder_id: 'F-01-02', substation_id: 'SUB-01', name: 'Feeder South' },
  ]

  const dts = []
  const poles = []
  const edges = []

  const dtConfigs = [
    { feeder: 'F-01-01', lat: BASE_LAT + 0.005, lon: BASE_LON + 0.003, poleCount: 12, surveyed: true },
    { feeder: 'F-01-01', lat: BASE_LAT + 0.008, lon: BASE_LON - 0.002, poleCount: 10, surveyed: true },
    { feeder: 'F-01-01', lat: BASE_LAT + 0.003, lon: BASE_LON + 0.008, poleCount: 8, surveyed: false },
    { feeder: 'F-01-02', lat: BASE_LAT - 0.004, lon: BASE_LON + 0.005, poleCount: 11, surveyed: true },
    { feeder: 'F-01-02', lat: BASE_LAT - 0.007, lon: BASE_LON - 0.003, poleCount: 9, surveyed: false },
    { feeder: 'F-01-02', lat: BASE_LAT - 0.002, lon: BASE_LON + 0.010, poleCount: 7, surveyed: true },
  ]

  let totalPoles = 0

  dtConfigs.forEach((cfg, dtIdx) => {
    const dtId = `DT-${String(dtIdx + 1).padStart(3, '0')}`

    dts.push({
      dt_id: dtId,
      feeder_id: cfg.feeder,
      lat: cfg.lat,
      lon: cfg.lon,
      capacity_kva: 100 + Math.floor(Math.random() * 150),
      households_served: 40 + Math.floor(Math.random() * 80),
      has_surveyed_topology: cfg.surveyed,
    })

    // Generate poles in a line extending from DT
    const angle = (dtIdx * 60 + 15) * (Math.PI / 180) // radial direction
    let prevId = dtId

    for (let i = 1; i <= cfg.poleCount; i++) {
      const poleId = generatePoleId(dtIdx + 1, i)
      const hasDevice = Math.random() > 0.09 // ~91% have devices
      const fw = Math.random() < 0.08 ? '1.2.1' : (Math.random() < 0.1 ? '1.3.0' : '1.4.2')

      const poleLat = cfg.lat + Math.cos(angle) * i * 0.00035 + (Math.random() - 0.5) * 0.00008
      const poleLon = cfg.lon + Math.sin(angle) * i * 0.00035 + (Math.random() - 0.5) * 0.00008

      poles.push({
        pole_id: poleId,
        lat: poleLat,
        lon: poleLon,
        dt_id: dtId,
        feeder_id: cfg.feeder,
        device_id: hasDevice ? generateDeviceId(dtIdx + 1, i) : null,
        fw_version: hasDevice ? fw : null,
        status: 'live',
        seq_on_line: i,
        parent_pole_id: prevId === dtId ? null : prevId,
        topology_source: cfg.surveyed ? 'surveyed' : 'inferred_gps',
        topology_confidence: cfg.surveyed ? 'HIGH' : 'MEDIUM',
        ward: `W-${String(80 + dtIdx).padStart(3, '0')}`,
        pincode: `5600${70 + dtIdx}`,
      })

      edges.push({
        from_id: prevId,
        to_id: poleId,
        dt_id: dtId,
        feeder_id: cfg.feeder,
        distance_m: 30 + Math.floor(Math.random() * 40),
        topology_source: cfg.surveyed ? 'surveyed' : 'inferred_gps',
      })

      prevId = poleId
      totalPoles++
    }

    // Add a branch on larger DTs
    if (cfg.poleCount >= 10) {
      const branchStart = generatePoleId(dtIdx + 1, Math.floor(cfg.poleCount / 3))
      for (let b = 1; b <= 3; b++) {
        const branchPoleId = `P-${String(dtIdx + 1).padStart(2, '0')}-B${b}`
        const bLat = cfg.lat + Math.cos(angle + 1.2) * (cfg.poleCount / 3 + b) * 0.00035
        const bLon = cfg.lon + Math.sin(angle + 1.2) * (cfg.poleCount / 3 + b) * 0.00035

        poles.push({
          pole_id: branchPoleId,
          lat: bLat,
          lon: bLon,
          dt_id: dtId,
          feeder_id: cfg.feeder,
          device_id: generateDeviceId(dtIdx + 1, 100 + b),
          fw_version: '1.4.2',
          status: 'live',
          seq_on_line: cfg.poleCount + b,
          parent_pole_id: b === 1 ? branchStart : `P-${String(dtIdx + 1).padStart(2, '0')}-B${b - 1}`,
          topology_source: cfg.surveyed ? 'surveyed' : 'inferred_gps',
          topology_confidence: cfg.surveyed ? 'HIGH' : 'MEDIUM',
          ward: `W-${String(80 + dtIdx).padStart(3, '0')}`,
          pincode: `5600${70 + dtIdx}`,
        })

        edges.push({
          from_id: b === 1 ? branchStart : `P-${String(dtIdx + 1).padStart(2, '0')}-B${b - 1}`,
          to_id: branchPoleId,
          dt_id: dtId,
          feeder_id: cfg.feeder,
          distance_m: 35 + Math.floor(Math.random() * 25),
          topology_source: cfg.surveyed ? 'surveyed' : 'inferred_gps',
        })

        totalPoles++
      }
    }
  })

  return { substations, feeders, dts, poles, edges, totalPoles }
}

// ── Generate & export ───────────────────────────────────────
const network = generateNetwork()

export const DEMO_POLES = network.poles
export const DEMO_DTS = network.dts
export const DEMO_EDGES = network.edges
export const DEMO_FEEDERS = network.feeders

export const DEMO_NETWORK_INFO = {
  poles: network.totalPoles,
  dts: network.dts.length,
  feeders: network.feeders.length,
  substations: 1,
  instrumented_pct: 91,
  hierarchy: [
    {
      substation_id: 'SUB-01',
      feeders: network.feeders.map(f => ({
        feeder_id: f.feeder_id,
        dt_count: network.dts.filter(d => d.feeder_id === f.feeder_id).length,
        dts: network.dts
          .filter(d => d.feeder_id === f.feeder_id)
          .map(d => ({
            dt_id: d.dt_id,
            pole_count: network.poles.filter(p => p.dt_id === d.dt_id).length,
            has_surveyed_topology: d.has_surveyed_topology,
          })),
      })),
    },
  ],
}

// ── Demo Tickets ────────────────────────────────────────────
const now = new Date()
const ago = (mins) => new Date(now.getTime() - mins * 60000).toISOString()

export const DEMO_TICKETS = [
  {
    ticket_id: 1,
    display_id: `FLT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-001`,
    status: 'detected',
    fault_type: 'span',
    feeder_id: 'F-01-01',
    dt_id: 'DT-001',
    boundary_live_pole: 'P-01-004',
    boundary_dark_pole: 'P-01-005',
    fault_lat: network.poles.find(p => p.pole_id === 'P-01-005')?.lat || BASE_LAT + 0.007,
    fault_lon: network.poles.find(p => p.pole_id === 'P-01-005')?.lon || BASE_LON + 0.005,
    pincode: '560070',
    is_range: false,
    range_description: null,
    affected_poles: ['P-01-005', 'P-01-006', 'P-01-007', 'P-01-008', 'P-01-009', 'P-01-010', 'P-01-011', 'P-01-012'],
    affected_pole_count: 8,
    estimated_households: 28,
    confidence_label: 'HIGH',
    confidence_factors: {
      topology_source: 'surveyed',
      detection_method: 'explicit_power_lost',
      corroborating_poles: 5,
      fault_type: 'span',
    },
    topology_source: 'surveyed',
    span_distance_m: 42.5,
    total_dark_line_length_m: 310.2,
    dt_distance_m: 168.0,
    priority_score: 244.1,
    detected_at: ago(12),
    acknowledged_at: null,
    crew_assigned_at: null,
    resolved_at: null,
    verified_at: null,
    closed_at: null,
    operator_notes: null,
  },
  {
    ticket_id: 2,
    display_id: `FLT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-002`,
    status: 'crew_assigned',
    fault_type: 'dt',
    feeder_id: 'F-01-02',
    dt_id: 'DT-004',
    boundary_live_pole: null,
    boundary_dark_pole: null,
    fault_lat: network.dts.find(d => d.dt_id === 'DT-004')?.lat || BASE_LAT - 0.004,
    fault_lon: network.dts.find(d => d.dt_id === 'DT-004')?.lon || BASE_LON + 0.005,
    pincode: '560073',
    is_range: false,
    range_description: null,
    affected_poles: network.poles.filter(p => p.dt_id === 'DT-004').map(p => p.pole_id),
    affected_pole_count: network.poles.filter(p => p.dt_id === 'DT-004').length,
    estimated_households: 65,
    confidence_label: 'HIGH',
    confidence_factors: {
      topology_source: 'surveyed',
      detection_method: 'explicit_power_lost',
      corroborating_poles: 8,
      fault_type: 'dt',
    },
    topology_source: 'surveyed',
    span_distance_m: 0,
    total_dark_line_length_m: 0,
    dt_distance_m: 0,
    priority_score: 430.0,
    detected_at: ago(45),
    acknowledged_at: ago(40),
    crew_assigned_at: ago(30),
    resolved_at: null,
    verified_at: null,
    closed_at: null,
    operator_notes: 'Crew CREW-02 dispatched to DT-004. Transformer suspected.',
  },
  {
    ticket_id: 3,
    display_id: `FLT-${now.toISOString().slice(0, 10).replace(/-/g, '')}-003`,
    status: 'verified',
    fault_type: 'span',
    feeder_id: 'F-01-01',
    dt_id: 'DT-002',
    boundary_live_pole: 'P-02-003',
    boundary_dark_pole: 'P-02-004',
    fault_lat: network.poles.find(p => p.pole_id === 'P-02-004')?.lat || BASE_LAT + 0.01,
    fault_lon: network.poles.find(p => p.pole_id === 'P-02-004')?.lon || BASE_LON - 0.001,
    pincode: '560071',
    is_range: false,
    range_description: null,
    affected_poles: ['P-02-004', 'P-02-005', 'P-02-006', 'P-02-007'],
    affected_pole_count: 4,
    estimated_households: 15,
    confidence_label: 'MEDIUM',
    confidence_factors: {
      topology_source: 'surveyed',
      detection_method: 'explicit_power_lost',
      corroborating_poles: 3,
      fault_type: 'span',
    },
    topology_source: 'surveyed',
    span_distance_m: 38.0,
    total_dark_line_length_m: 145.6,
    dt_distance_m: 112.3,
    priority_score: 123.6,
    detected_at: ago(120),
    acknowledged_at: ago(115),
    crew_assigned_at: ago(100),
    resolved_at: ago(60),
    verified_at: ago(55),
    closed_at: null,
    operator_notes: 'Wire splice repaired. All poles restored.',
  },
]

// Mark affected poles as dark for active tickets
DEMO_TICKETS.forEach(t => {
  if (t.status !== 'verified' && t.status !== 'closed') {
    t.affected_poles.forEach(poleId => {
      const pole = DEMO_POLES.find(p => p.pole_id === poleId)
      if (pole) pole.status = 'confirmed_dark'
    })
  }
})

// ── Demo Analytics ──────────────────────────────────────────
export const DEMO_ANALYTICS = {
  network_health: {
    total_poles: network.totalPoles,
    live_poles: network.totalPoles - 19,
    dark_poles: 19,
    unknown_poles: 0,
    health_pct: Math.round(((network.totalPoles - 19) / network.totalPoles) * 100 * 10) / 10,
    total_dts: network.dts.length,
    affected_dts: 2,
    total_feeders: 2,
    affected_feeders: 2,
  },
  reliability: {
    mttr_minutes: 68,
    mtbf_hours: 142,
    avg_detection_seconds: 38,
    avg_verification_seconds: 14,
    tickets_today: 3,
    tickets_resolved_today: 1,
  },
  fault_distribution: {
    span: 2,
    dt: 1,
    feeder: 0,
  },
  confidence_distribution: {
    HIGH: 2,
    MEDIUM: 1,
    LOW: 0,
  },
}

// ── Demo Crews ──────────────────────────────────────────────
export const DEMO_CREWS = [
  {
    crew_id: 'CREW-01',
    name: 'North Line Maintenance Alpha',
    lead_name: 'Rajesh Kumar',
    contact: '+91 98450 12345',
    status: 'available',
    base_station: 'Substation 01 Depot',
    active_ticket: null,
  },
  {
    crew_id: 'CREW-02',
    name: 'South Rapid Response Bravo',
    lead_name: 'Anita Sharma',
    contact: '+91 98450 67890',
    status: 'dispatched',
    base_station: 'Sector 4 Service Center',
    active_ticket: DEMO_TICKETS[1]?.display_id || null,
  },
  {
    crew_id: 'CREW-03',
    name: 'Central Transformer Squad',
    lead_name: 'Vikram Singh',
    contact: '+91 98450 54321',
    status: 'available',
    base_station: 'Central DISCOM Yard',
    active_ticket: null,
  },
]

// ── Demo Outages ────────────────────────────────────────────
export const DEMO_OUTAGES = [
  {
    outage_id: 1,
    scope: 'feeder',
    target_id: 'F-01-02',
    reason: 'Planned maintenance — transformer oil replacement',
    scheduled_start: new Date(now.getTime() + 2 * 86400000).toISOString(),
    scheduled_end: new Date(now.getTime() + 2 * 86400000 + 4 * 3600000).toISOString(),
    cancelled: false,
    created_at: ago(1440),
  },
]

// ── Demo Audit Log ──────────────────────────────────────────
export const DEMO_AUDIT_LOG = [
  { id: 1, action: 'LOGIN', user: 'admin@gridops.ai', details: 'Admin login', timestamp: ago(120) },
  { id: 2, action: 'TICKET_ACKNOWLEDGE', user: 'operator@gridops.ai', details: `Acknowledged ${DEMO_TICKETS[1]?.display_id}`, timestamp: ago(40) },
  { id: 3, action: 'CREW_DISPATCH', user: 'operator@gridops.ai', details: `Dispatched CREW-02 to ${DEMO_TICKETS[1]?.display_id}`, timestamp: ago(30) },
  { id: 4, action: 'TICKET_VERIFIED', user: 'SYSTEM', details: `Auto-verified ${DEMO_TICKETS[2]?.display_id} — all poles restored`, timestamp: ago(55) },
  { id: 5, action: 'SIMULATOR_FAULT', user: 'admin@gridops.ai', details: 'Injected span fault on DT-001', timestamp: ago(12) },
]

// ── Demo System Health ──────────────────────────────────────
export const DEMO_HEALTH = {
  status: 'healthy',
  engine_initialized: true,
  poles_tracked: network.totalPoles,
  uptime_seconds: 86400,
  sweep_interval: 10,
  last_sweep_ms: 2.3,
  active_sse_connections: 1,
  database: 'sqlite (demo mode)',
  python_version: '3.11.5',
  fastapi_version: '0.115.0',
}

// ── Demo AI Explanation ─────────────────────────────────────
export function generateDemoExplanation(ticket) {
  const typeDesc = {
    span: 'a wire break between two adjacent poles on the distribution line',
    dt: 'a distribution transformer failure affecting all downstream poles',
    feeder: 'an 11kV feeder line failure affecting all transformers on the circuit',
  }

  return {
    explanation: `This is ${typeDesc[ticket.fault_type] || 'a fault'} detected on ${ticket.dt_id || ticket.feeder_id}. ` +
      `${ticket.affected_pole_count} poles are affected, impacting an estimated ${ticket.estimated_households} households. ` +
      `The fault was detected with ${ticket.confidence_label} confidence using ${ticket.topology_source} topology data. ` +
      (ticket.boundary_live_pole
        ? `The boundary is between pole ${ticket.boundary_live_pole} (last energized) and ${ticket.boundary_dark_pole} (first de-energized), ` +
          `spanning ${ticket.span_distance_m}m. The total de-energized line length is ${ticket.total_dark_line_length_m}m.`
        : `All poles under this ${ticket.fault_type === 'dt' ? 'transformer' : 'feeder'} are de-energized.`),
    model: 'demo-mode (local)',
    cached: false,
  }
}
