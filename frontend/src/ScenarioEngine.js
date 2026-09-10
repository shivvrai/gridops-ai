/**
 * ScenarioEngine — Generates random incident scenarios and tracks mission progress.
 * All state persisted in localStorage so it survives role switches and page refreshes.
 */

const STORAGE_KEYS = {
  SCENARIO: 'gridops_scenario',
  MISSIONS_PREFIX: 'gridops_missions_',
}

// ── Scenario Templates ──────────────────────────────────────
const SCENARIO_TEMPLATES = [
  {
    name: 'Monsoon Storm Surge',
    description: 'Heavy monsoon rains have caused multiple line failures across the northern feeder. Fallen branches and waterlogging suspected.',
    icon: '🌧️',
    faultCount: 2,
    faultTypes: ['span', 'span'],
    severity: 'HIGH',
  },
  {
    name: 'Transformer Overload',
    description: 'A distribution transformer in the southern sector has failed due to sustained overload during peak summer demand.',
    icon: '🔥',
    faultCount: 1,
    faultTypes: ['dt'],
    severity: 'HIGH',
  },
  {
    name: 'Cable Theft Incident',
    description: 'Reports of cable theft on Feeder North. Multiple spans are down and a large residential area is without power.',
    icon: '🚨',
    faultCount: 2,
    faultTypes: ['span', 'span'],
    severity: 'MEDIUM',
  },
  {
    name: 'Vehicle Collision',
    description: 'A truck collided with a distribution pole on Ring Road. The pole and adjacent span are damaged. Emergency response required.',
    icon: '🚛',
    faultCount: 1,
    faultTypes: ['span'],
    severity: 'HIGH',
  },
  {
    name: 'Feeder Trip Event',
    description: 'The 11kV feeder breaker has tripped due to a sustained fault. All downstream transformers are de-energized.',
    icon: '⚡',
    faultCount: 1,
    faultTypes: ['feeder'],
    severity: 'CRITICAL',
  },
  {
    name: 'Multi-Point Failure',
    description: 'Simultaneous faults detected across two different feeders — possible upstream grid instability or cascading failure.',
    icon: '💥',
    faultCount: 3,
    faultTypes: ['span', 'dt', 'span'],
    severity: 'CRITICAL',
  },
]

// ── Network Generation ──────────────────────────────────────
const BASE_LAT = 12.9716
const BASE_LON = 77.5946

function seededRandom(seed) {
  let s = seed
  return function () {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

function generateScenarioNetwork(rng) {
  const substations = [
    { substation_id: 'SUB-01', lat: BASE_LAT, lon: BASE_LON, name: 'Koramangala 66kV' },
  ]

  const feeders = [
    { feeder_id: 'F-01-01', substation_id: 'SUB-01', name: 'Feeder North' },
    { feeder_id: 'F-01-02', substation_id: 'SUB-01', name: 'Feeder South' },
  ]

  const dtConfigs = [
    { feeder: 'F-01-01', lat: BASE_LAT + 0.005, lon: BASE_LON + 0.003, poleCount: 12, surveyed: true, name: 'HSR Layout DT' },
    { feeder: 'F-01-01', lat: BASE_LAT + 0.008, lon: BASE_LON - 0.002, poleCount: 10, surveyed: true, name: 'Madiwala DT' },
    { feeder: 'F-01-01', lat: BASE_LAT + 0.003, lon: BASE_LON + 0.008, poleCount: 8, surveyed: false, name: 'BTM Layout DT' },
    { feeder: 'F-01-02', lat: BASE_LAT - 0.004, lon: BASE_LON + 0.005, poleCount: 11, surveyed: true, name: 'JP Nagar DT' },
    { feeder: 'F-01-02', lat: BASE_LAT - 0.007, lon: BASE_LON - 0.003, poleCount: 9, surveyed: false, name: 'Jayanagar DT' },
    { feeder: 'F-01-02', lat: BASE_LAT - 0.002, lon: BASE_LON + 0.010, poleCount: 7, surveyed: true, name: 'Bannerghatta DT' },
  ]

  const dts = []
  const poles = []
  const edges = []
  let totalPoles = 0

  dtConfigs.forEach((cfg, dtIdx) => {
    const dtId = `DT-${String(dtIdx + 1).padStart(3, '0')}`
    dts.push({
      dt_id: dtId,
      feeder_id: cfg.feeder,
      lat: cfg.lat,
      lon: cfg.lon,
      capacity_kva: 100 + Math.floor(rng() * 150),
      households_served: 40 + Math.floor(rng() * 80),
      has_surveyed_topology: cfg.surveyed,
      name: cfg.name,
    })

    const angle = (dtIdx * 60 + 15) * (Math.PI / 180)
    let prevId = dtId

    for (let i = 1; i <= cfg.poleCount; i++) {
      const poleId = `P-${String(dtIdx + 1).padStart(2, '0')}-${String(i).padStart(3, '0')}`
      const hasDevice = rng() > 0.09
      const fw = rng() < 0.08 ? '1.2.1' : (rng() < 0.1 ? '1.3.0' : '1.4.2')
      const poleLat = cfg.lat + Math.cos(angle) * i * 0.00035 + (rng() - 0.5) * 0.00008
      const poleLon = cfg.lon + Math.sin(angle) * i * 0.00035 + (rng() - 0.5) * 0.00008

      poles.push({
        pole_id: poleId,
        lat: poleLat,
        lon: poleLon,
        dt_id: dtId,
        feeder_id: cfg.feeder,
        device_id: hasDevice ? `DEV-${String(dtIdx + 1).padStart(2, '0')}-${String(i).padStart(3, '0')}` : null,
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
        distance_m: 30 + Math.floor(rng() * 40),
        topology_source: cfg.surveyed ? 'surveyed' : 'inferred_gps',
      })

      prevId = poleId
      totalPoles++
    }

    // Add branch on larger DTs
    if (cfg.poleCount >= 10) {
      const branchStart = `P-${String(dtIdx + 1).padStart(2, '0')}-${String(Math.floor(cfg.poleCount / 3)).padStart(3, '0')}`
      for (let b = 1; b <= 3; b++) {
        const branchPoleId = `P-${String(dtIdx + 1).padStart(2, '0')}-B${b}`
        const bLat = cfg.lat + Math.cos(angle + 1.2) * (cfg.poleCount / 3 + b) * 0.00035
        const bLon = cfg.lon + Math.sin(angle + 1.2) * (cfg.poleCount / 3 + b) * 0.00035

        poles.push({
          pole_id: branchPoleId, lat: bLat, lon: bLon,
          dt_id: dtId, feeder_id: cfg.feeder,
          device_id: `DEV-${String(dtIdx + 1).padStart(2, '0')}-B${b}`,
          fw_version: '1.4.2', status: 'live', seq_on_line: cfg.poleCount + b,
          parent_pole_id: b === 1 ? branchStart : `P-${String(dtIdx + 1).padStart(2, '0')}-B${b - 1}`,
          topology_source: cfg.surveyed ? 'surveyed' : 'inferred_gps',
          topology_confidence: cfg.surveyed ? 'HIGH' : 'MEDIUM',
          ward: `W-${String(80 + dtIdx).padStart(3, '0')}`,
          pincode: `5600${70 + dtIdx}`,
        })
        edges.push({
          from_id: b === 1 ? branchStart : `P-${String(dtIdx + 1).padStart(2, '0')}-B${b - 1}`,
          to_id: branchPoleId, dt_id: dtId, feeder_id: cfg.feeder,
          distance_m: 35 + Math.floor(rng() * 25),
          topology_source: cfg.surveyed ? 'surveyed' : 'inferred_gps',
        })
        totalPoles++
      }
    }
  })

  return { substations, feeders, dts, poles, edges, totalPoles }
}

// ── Fault Injection ─────────────────────────────────────────
function injectFaults(network, template, rng) {
  const { poles, dts } = network
  const tickets = []
  const now = new Date()
  const ago = (mins) => new Date(now.getTime() - mins * 60000).toISOString()
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '')

  const availableDts = [...dts]

  template.faultTypes.forEach((faultType, idx) => {
    if (faultType === 'feeder') {
      // Feeder-level fault — all DTs on one feeder go dark
      const feederId = rng() > 0.5 ? 'F-01-01' : 'F-01-02'
      const feederPoles = poles.filter(p => p.feeder_id === feederId)
      feederPoles.forEach(p => { p.status = 'confirmed_dark' })

      tickets.push({
        ticket_id: idx + 1,
        display_id: `FLT-${dateStr}-${String(idx + 1).padStart(3, '0')}`,
        status: 'detected',
        fault_type: 'feeder',
        feeder_id: feederId,
        dt_id: null,
        boundary_live_pole: null,
        boundary_dark_pole: null,
        fault_lat: feederPoles[0]?.lat || BASE_LAT,
        fault_lon: feederPoles[0]?.lon || BASE_LON,
        pincode: feederPoles[0]?.pincode || '560070',
        is_range: false,
        affected_poles: feederPoles.map(p => p.pole_id),
        affected_pole_count: feederPoles.length,
        estimated_households: feederPoles.length * 5,
        confidence_label: 'HIGH',
        confidence_factors: { topology_source: 'surveyed', fault_type: 'feeder', corroborating_poles: feederPoles.length },
        topology_source: 'surveyed',
        span_distance_m: 0,
        total_dark_line_length_m: 0,
        dt_distance_m: 0,
        priority_score: 500 + feederPoles.length * 2,
        detected_at: ago(3 + idx * 2),
        acknowledged_at: null, crew_assigned_at: null, resolved_at: null, verified_at: null, closed_at: null,
        operator_notes: null,
      })
    } else if (faultType === 'dt') {
      // DT-level fault
      const dtIdx = Math.floor(rng() * availableDts.length)
      const dt = availableDts.splice(dtIdx, 1)[0] || dts[0]
      const dtPoles = poles.filter(p => p.dt_id === dt.dt_id)
      dtPoles.forEach(p => { p.status = 'confirmed_dark' })

      tickets.push({
        ticket_id: idx + 1,
        display_id: `FLT-${dateStr}-${String(idx + 1).padStart(3, '0')}`,
        status: 'detected',
        fault_type: 'dt',
        feeder_id: dt.feeder_id,
        dt_id: dt.dt_id,
        boundary_live_pole: null,
        boundary_dark_pole: null,
        fault_lat: dt.lat,
        fault_lon: dt.lon,
        pincode: dtPoles[0]?.pincode || '560070',
        is_range: false,
        affected_poles: dtPoles.map(p => p.pole_id),
        affected_pole_count: dtPoles.length,
        estimated_households: dt.households_served || 60,
        confidence_label: 'HIGH',
        confidence_factors: { topology_source: 'surveyed', fault_type: 'dt', corroborating_poles: dtPoles.length },
        topology_source: dtPoles[0]?.topology_source || 'surveyed',
        span_distance_m: 0,
        total_dark_line_length_m: 0,
        dt_distance_m: 0,
        priority_score: 300 + dtPoles.length * 3,
        detected_at: ago(5 + idx * 3),
        acknowledged_at: null, crew_assigned_at: null, resolved_at: null, verified_at: null, closed_at: null,
        operator_notes: null,
      })
    } else {
      // Span fault
      const dtIdx = Math.floor(rng() * availableDts.length)
      const dt = availableDts.splice(dtIdx, 1)[0] || dts[0]
      const dtPoles = poles.filter(p => p.dt_id === dt.dt_id).sort((a, b) => a.seq_on_line - b.seq_on_line)
      const faultAfter = Math.floor(dtPoles.length * 0.3 + rng() * dtPoles.length * 0.3)
      const livePole = dtPoles[faultAfter]
      const darkPoles = dtPoles.slice(faultAfter + 1)
      darkPoles.forEach(p => { p.status = 'confirmed_dark' })

      if (darkPoles.length > 0) {
        const spanDist = 35 + Math.floor(rng() * 30)
        tickets.push({
          ticket_id: idx + 1,
          display_id: `FLT-${dateStr}-${String(idx + 1).padStart(3, '0')}`,
          status: 'detected',
          fault_type: 'span',
          feeder_id: dt.feeder_id,
          dt_id: dt.dt_id,
          boundary_live_pole: livePole?.pole_id || null,
          boundary_dark_pole: darkPoles[0]?.pole_id || null,
          fault_lat: darkPoles[0]?.lat || dt.lat,
          fault_lon: darkPoles[0]?.lon || dt.lon,
          pincode: darkPoles[0]?.pincode || '560070',
          is_range: false,
          affected_poles: darkPoles.map(p => p.pole_id),
          affected_pole_count: darkPoles.length,
          estimated_households: Math.round((dt.households_served || 50) * (darkPoles.length / Math.max(dtPoles.length, 1))),
          confidence_label: livePole ? 'HIGH' : 'MEDIUM',
          confidence_factors: {
            topology_source: dt.has_surveyed_topology ? 'surveyed' : 'inferred_gps',
            detection_method: 'explicit_power_lost',
            corroborating_poles: Math.min(darkPoles.length, 5),
            fault_type: 'span',
          },
          topology_source: dt.has_surveyed_topology ? 'surveyed' : 'inferred_gps',
          span_distance_m: spanDist,
          total_dark_line_length_m: darkPoles.length * spanDist,
          dt_distance_m: (faultAfter + 1) * spanDist,
          priority_score: 100 + darkPoles.length * 8,
          detected_at: ago(2 + idx * 4),
          acknowledged_at: null, crew_assigned_at: null, resolved_at: null, verified_at: null, closed_at: null,
          operator_notes: null,
        })
      }
    }
  })

  return tickets
}

// ── Mission Definitions ─────────────────────────────────────
function getMissionDefinitions(role, ticketCount) {
  const missions = {
    ADMIN: [
      { id: 'admin_health', label: 'Review System Health dashboard', icon: '🩺', action: 'view_health' },
      { id: 'admin_audit', label: 'Check Audit Log for recent activity', icon: '📜', action: 'view_audit' },
      { id: 'admin_crews', label: 'Verify crew availability', icon: '👷', action: 'view_crews' },
      { id: 'admin_review_tickets', label: 'Review all active fault tickets', icon: '🎫', action: 'view_ticket_detail' },
      { id: 'admin_dashboard', label: 'Check analytics dashboard', icon: '📊', action: 'view_dashboard' },
      { id: 'admin_topology', label: 'Inspect network topology on the map', icon: '🗺️', action: 'view_map' },
    ],
    OPERATOR: [
      { id: 'op_view_tickets', label: 'View all detected tickets', icon: '🎫', action: 'view_tickets' },
      { id: 'op_acknowledge', label: `Acknowledge all ${ticketCount} detected ticket(s)`, icon: '✅', action: 'acknowledge_ticket', requiredCount: ticketCount },
      { id: 'op_assign_crew', label: 'Assign a crew to an acknowledged ticket', icon: '👷', action: 'assign_crew' },
      { id: 'op_explain', label: 'Use AI Explain on a ticket', icon: '🤖', action: 'explain_ticket' },
      { id: 'op_investigate', label: 'Open Investigation view on a ticket', icon: '🔍', action: 'investigate_ticket' },
      { id: 'op_dashboard', label: 'Check the analytics dashboard', icon: '📊', action: 'view_dashboard' },
    ],
    FIELD_CREW: [
      { id: 'fc_view_incidents', label: 'View your assigned incidents', icon: '📋', action: 'view_crews' },
      { id: 'fc_open_detail', label: 'Open ticket details and review affected poles', icon: '🔎', action: 'view_ticket_detail' },
      { id: 'fc_repair', label: 'Repair faulted poles (use Repair action)', icon: '🔧', action: 'repair_poles' },
      { id: 'fc_verify', label: 'Verify all affected poles are restored', icon: '✅', action: 'verify_restoration' },
    ],
  }

  return missions[role] || missions.OPERATOR
}

// ── Crews ───────────────────────────────────────────────────
const SCENARIO_CREWS = [
  { crew_id: 'CREW-01', name: 'North Line Maintenance Alpha', lead_name: 'Rajesh Kumar', contact: '+91 98450 12345', status: 'available', base_station: 'Substation 01 Depot' },
  { crew_id: 'CREW-02', name: 'South Rapid Response Bravo', lead_name: 'Anita Sharma', contact: '+91 98450 67890', status: 'available', base_station: 'Sector 4 Service Center' },
  { crew_id: 'CREW-03', name: 'Central Transformer Squad', lead_name: 'Vikram Singh', contact: '+91 98450 54321', status: 'available', base_station: 'Central DISCOM Yard' },
]

// ── ScenarioEngine Class ────────────────────────────────────
class ScenarioEngine {
  constructor() {
    this._scenario = null
    this._loadFromCache()
  }

  _loadFromCache() {
    try {
      const cached = localStorage.getItem(STORAGE_KEYS.SCENARIO)
      if (cached) {
        this._scenario = JSON.parse(cached)
      }
    } catch {
      this._scenario = null
    }
  }

  _saveToCache() {
    if (this._scenario) {
      localStorage.setItem(STORAGE_KEYS.SCENARIO, JSON.stringify(this._scenario))
    }
  }

  hasScenario() {
    return !!this._scenario
  }

  getScenario() {
    return this._scenario
  }

  generateScenario(forceSeed) {
    const seed = forceSeed || Date.now()
    const rng = seededRandom(seed)

    // Pick random scenario template
    const template = SCENARIO_TEMPLATES[Math.floor(rng() * SCENARIO_TEMPLATES.length)]

    // Generate network
    const network = generateScenarioNetwork(rng)

    // Inject faults
    const tickets = injectFaults(network, template, rng)

    // Count affected stats
    const darkPoles = network.poles.filter(p => p.status === 'confirmed_dark')
    const affectedDts = [...new Set(darkPoles.map(p => p.dt_id))]
    const totalHouseholds = tickets.reduce((sum, t) => sum + (t.estimated_households || 0), 0)

    // Build network info
    const networkInfo = {
      poles: network.totalPoles,
      dts: network.dts.length,
      feeders: network.feeders.length,
      substations: 1,
      instrumented_pct: 91,
      hierarchy: [{
        substation_id: 'SUB-01',
        feeders: network.feeders.map(f => ({
          feeder_id: f.feeder_id,
          dt_count: network.dts.filter(d => d.feeder_id === f.feeder_id).length,
          dts: network.dts.filter(d => d.feeder_id === f.feeder_id).map(d => ({
            dt_id: d.dt_id,
            pole_count: network.poles.filter(p => p.dt_id === d.dt_id).length,
            has_surveyed_topology: d.has_surveyed_topology,
          })),
        })),
      }],
    }

    // Analytics
    const analytics = {
      network_health: {
        total_poles: network.totalPoles,
        live_poles: network.totalPoles - darkPoles.length,
        dark_poles: darkPoles.length,
        unknown_poles: 0,
        health_pct: Math.round(((network.totalPoles - darkPoles.length) / network.totalPoles) * 1000) / 10,
        total_dts: network.dts.length,
        affected_dts: affectedDts.length,
        total_feeders: 2,
        affected_feeders: [...new Set(darkPoles.map(p => p.feeder_id))].length,
      },
      reliability: {
        mttr_minutes: 45 + Math.floor(rng() * 40),
        mtbf_hours: 100 + Math.floor(rng() * 100),
        avg_detection_seconds: 30 + Math.floor(rng() * 20),
        avg_verification_seconds: 10 + Math.floor(rng() * 10),
        tickets_today: tickets.length,
        tickets_resolved_today: 0,
      },
      fault_distribution: {
        span: tickets.filter(t => t.fault_type === 'span').length,
        dt: tickets.filter(t => t.fault_type === 'dt').length,
        feeder: tickets.filter(t => t.fault_type === 'feeder').length,
      },
      confidence_distribution: {
        HIGH: tickets.filter(t => t.confidence_label === 'HIGH').length,
        MEDIUM: tickets.filter(t => t.confidence_label === 'MEDIUM').length,
        LOW: tickets.filter(t => t.confidence_label === 'LOW').length,
      },
    }

    this._scenario = {
      seed,
      template: { name: template.name, description: template.description, icon: template.icon, severity: template.severity },
      network,
      tickets,
      networkInfo,
      analytics,
      crews: JSON.parse(JSON.stringify(SCENARIO_CREWS)),
      outages: [],
      darkPoleCount: darkPoles.length,
      affectedDtCount: affectedDts.length,
      totalHouseholds,
      createdAt: new Date().toISOString(),
    }

    this._saveToCache()
    return this._scenario
  }

  resetScenario() {
    this._scenario = null
    localStorage.removeItem(STORAGE_KEYS.SCENARIO)
    // Clear all mission progress
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(STORAGE_KEYS.MISSIONS_PREFIX)) {
        localStorage.removeItem(key)
      }
    })
  }

  // ── Mission Progress ────────────────────────────────────
  getMissions(role) {
    const ticketCount = this._scenario?.tickets?.filter(t => t.status === 'detected').length || 1
    return getMissionDefinitions(role, ticketCount)
  }

  getProgress(role) {
    const key = STORAGE_KEYS.MISSIONS_PREFIX + role
    try {
      const cached = localStorage.getItem(key)
      if (cached) return JSON.parse(cached)
    } catch { /* ignore */ }
    return {}
  }

  markComplete(role, missionId) {
    const key = STORAGE_KEYS.MISSIONS_PREFIX + role
    const progress = this.getProgress(role)
    if (!progress[missionId]) {
      progress[missionId] = { done: true, at: new Date().toISOString() }
      localStorage.setItem(key, JSON.stringify(progress))
    }
    return progress
  }

  // Track an action and auto-mark matching missions
  trackAction(role, action, extra = {}) {
    const missions = this.getMissions(role)
    const progress = this.getProgress(role)

    missions.forEach(m => {
      if (m.action === action && !progress[m.id]) {
        // For acknowledge — check if ALL tickets are acknowledged
        if (m.requiredCount && action === 'acknowledge_ticket') {
          const ackCount = (extra.acknowledgedCount || 0)
          if (ackCount >= m.requiredCount) {
            this.markComplete(role, m.id)
          }
        } else {
          this.markComplete(role, m.id)
        }
      }
    })

    return this.getProgress(role)
  }

  getCompletionStats(role) {
    const missions = this.getMissions(role)
    const progress = this.getProgress(role)
    const completed = missions.filter(m => progress[m.id]?.done).length
    return { completed, total: missions.length, allDone: completed === missions.length }
  }

  // Update scenario state (tickets, poles) in cache
  updateScenarioState(updates) {
    if (!this._scenario) return
    if (updates.tickets) this._scenario.tickets = updates.tickets
    if (updates.poles) this._scenario.network.poles = updates.poles
    if (updates.crews) this._scenario.crews = updates.crews
    this._saveToCache()
  }
}

// Singleton
const engine = new ScenarioEngine()
export default engine
