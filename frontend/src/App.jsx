import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import NetworkCanvas from './components/NetworkCanvas'
import TicketList from './components/TicketList'
import TicketDetail from './components/TicketDetail'
import SimulatorPanel from './components/SimulatorPanel'
import DashboardPanel from './components/DashboardPanel'
import DataLoaderPanel from './components/DataLoaderPanel'
import CsvImportWizard from './components/CsvImportWizard'
import MapControls from './components/MapControls'
import FeederView from './components/FeederView'
import IncidentInvestigation from './components/IncidentInvestigation'
import CrewManagementPanel from './components/CrewManagementPanel'
import OutageManagementPanel from './components/OutageManagementPanel'
import AuditLogPanel from './components/AuditLogPanel'
import SystemHealthPanel from './components/SystemHealthPanel'
import LoginModal from './components/LoginModal'
import ToastContainer from './components/ToastContainer'
import { AuthProvider, useAuth } from './context/AuthContext'
import {
  DEMO_POLES, DEMO_DTS, DEMO_EDGES, DEMO_NETWORK_INFO, DEMO_TICKETS,
  DEMO_ANALYTICS, DEMO_CREWS, DEMO_OUTAGES, DEMO_AUDIT_LOG, DEMO_HEALTH,
  generateDemoExplanation,
} from './mockData'

const API_URL = import.meta.env.VITE_API_BASE_URL || (
  window.location.hostname === 'localhost'
    ? 'http://localhost:8000'
    : `${window.location.protocol}//${window.location.hostname}:8000`
)

function MainApp() {
  const { user, token, loading: authLoading, logout, isAdmin, isOperator, isFieldCrew, demoMode } = useAuth()

  const [tickets, setTickets] = useState([])
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [showInvestigation, setShowInvestigation] = useState(false)
  const [poles, setPoles] = useState([])
  const [dts, setDts] = useState([])
  const [edges, setEdges] = useState([])
  const [networkInfo, setNetworkInfo] = useState(null)
  const [activeTab, setActiveTab] = useState('tickets')
  const [dataSubMode, setDataSubMode] = useState('wizard') // 'wizard' or 'uploader'
  const [toasts, setToasts] = useState([])

  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef(null)

  // Map layers and operational filters
  const [layers, setLayers] = useState({
    poles: true,
    transformers: true,
    topology: true,
    feeders: true,
    faults: true,
    devices: true,
    outages: false,
    crews: false,
  })

  const [filters, setFilters] = useState({
    feeder: '',
    dt: '',
    poleStatus: '',
    confidence: '',
  })

  const [mapPreviewData, setMapPreviewData] = useState(null)

  const addToast = useCallback((title, message, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, title, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 6000)
  }, [])

  // Fetch initial grid data
  const fetchData = useCallback(async () => {
    // Demo mode: use local mock data
    if (demoMode) {
      setTickets([...DEMO_TICKETS])
      setPoles([...DEMO_POLES])
      setDts([...DEMO_DTS])
      setEdges([...DEMO_EDGES])
      setNetworkInfo({ ...DEMO_NETWORK_INFO })
      setConnected(true)
      return
    }

    try {
      const [ticketsRes, polesRes, dtsRes, edgesRes, infoRes] = await Promise.all([
        fetch(`${API_URL}/api/tickets/`),
        fetch(`${API_URL}/api/simulator/poles`),
        fetch(`${API_URL}/api/simulator/dts`),
        fetch(`${API_URL}/api/simulator/edges`),
        fetch(`${API_URL}/api/simulator/network/info`),
      ])

      if (ticketsRes.ok) setTickets(await ticketsRes.json())
      if (polesRes.ok) setPoles(await polesRes.json())
      if (dtsRes.ok) setDts(await dtsRes.json())
      if (edgesRes.ok) setEdges(await edgesRes.json())
      if (infoRes.ok) setNetworkInfo(await infoRes.json())
    } catch (err) {
      console.error('Failed to fetch data:', err)
    }
  }, [demoMode])

  // SSE connection for real-time updates
  useEffect(() => {
    if (!token || demoMode) return

    const connectSSE = () => {
      const es = new EventSource(`${API_URL}/api/events/stream`)

      es.addEventListener('connected', () => {
        setConnected(true)
      })

      es.addEventListener('update', (event) => {
        try {
          const payload = JSON.parse(event.data)
          const { type, data } = payload

          if (type === 'ticket_created') {
            setTickets(prev => [data, ...prev])
            addToast(
              `⚡ New Fault: ${data.display_id}`,
              `${data.fault_type} fault — ${data.affected_pole_count} poles affected`,
              'fault'
            )
            fetch(`${API_URL}/api/simulator/poles`).then(r => r.ok && r.json().then(setPoles))
          } else if (type === 'ticket_updated') {
            setTickets(prev => prev.map(t =>
              t.display_id === data.display_id ? { ...t, ...data } : t
            ))
          } else if (type === 'ticket_verified') {
            setTickets(prev => prev.map(t =>
              t.display_id === data.display_id ? { ...t, status: 'verified' } : t
            ))
            addToast(
              `✅ Verified: ${data.display_id}`,
              'All affected poles are energized',
              'success'
            )
            fetch(`${API_URL}/api/simulator/poles`).then(r => r.ok && r.json().then(setPoles))
          } else if (type === 'device_anomaly') {
            addToast(
              '⚠️ Device Anomaly',
              `Pole ${data.pole_id}: ${data.reason}`,
              'info'
            )
          }
        } catch (e) {
          console.error('SSE parse error:', e)
        }
      })

      es.onerror = () => {
        setConnected(false)
        es.close()
        setTimeout(connectSSE, 3000)
      }

      eventSourceRef.current = es
    }

    connectSSE()
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [token, addToast])

  useEffect(() => {
    if (token) {
      fetchData()
      const interval = setInterval(fetchData, 15000)
      return () => clearInterval(interval)
    }
  }, [token, fetchData])

  // Set default tab for Field Crew
  useEffect(() => {
    if (isFieldCrew && activeTab === 'tickets') {
      setActiveTab('crews')
    }
  }, [isFieldCrew])

  const handleTransition = async (displayId, newStatus) => {
    // Demo mode: update local state
    if (demoMode) {
      setTickets(prev => prev.map(t => {
        if (t.display_id === displayId) {
          const updated = { ...t, status: newStatus }
          if (newStatus === 'acknowledged') updated.acknowledged_at = new Date().toISOString()
          if (newStatus === 'crew_assigned') updated.crew_assigned_at = new Date().toISOString()
          if (newStatus === 'resolved') updated.resolved_at = new Date().toISOString()
          if (newStatus === 'verified') updated.verified_at = new Date().toISOString()
          if (newStatus === 'closed') updated.closed_at = new Date().toISOString()
          if (selectedTicket?.display_id === displayId) setSelectedTicket(updated)
          return updated
        }
        return t
      }))
      addToast('Ticket Updated', `${displayId} → ${newStatus}`, 'success')
      return
    }

    try {
      const res = await fetch(`${API_URL}/api/tickets/${displayId}/transition`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast('Ticket Updated', data.message, 'success')
        await fetchData()
        if (selectedTicket?.display_id === displayId) {
          const ticketRes = await fetch(`${API_URL}/api/tickets/${displayId}`)
          if (ticketRes.ok) setSelectedTicket(await ticketRes.json())
        }
      } else {
        addToast('Action Failed', data.detail || 'Transition rejected', 'fault')
      }
    } catch (err) {
      addToast('Error', err.message, 'fault')
    }
  }

  const handleExplain = async (displayId) => {
    // Demo mode: return local explanation
    if (demoMode) {
      const ticket = tickets.find(t => t.display_id === displayId)
      if (ticket) return generateDemoExplanation(ticket)
      return null
    }

    try {
      const res = await fetch(`${API_URL}/api/ai/explain/${displayId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) return await res.json()
    } catch (err) {
      console.error('Explain failed:', err)
    }
    return null
  }

  const handleInjectFault = async (type, targetId, parentId) => {
    // Demo mode: simulate locally
    if (demoMode) {
      const poleId = targetId.startsWith('bp-') ? targetId.slice(3) : targetId
      const dtId = type === 'dt' ? (targetId.startsWith('bdt-') ? targetId.slice(4) : targetId) : parentId
      const affectedPoles = poles.filter(p => p.dt_id === dtId && (type === 'dt' || p.seq_on_line > (poles.find(pp => pp.pole_id === poleId)?.seq_on_line || 0)))
      setPoles(prev => prev.map(p => affectedPoles.find(a => a.pole_id === p.pole_id) ? { ...p, status: 'confirmed_dark' } : p))
      const newTicket = {
        ticket_id: Date.now(),
        display_id: `FLT-DEMO-${String(tickets.length + 1).padStart(3, '0')}`,
        status: 'detected',
        fault_type: type,
        feeder_id: affectedPoles[0]?.feeder_id || 'F-01-01',
        dt_id: dtId,
        boundary_live_pole: type === 'span' ? poleId : null,
        boundary_dark_pole: affectedPoles[0]?.pole_id || null,
        fault_lat: affectedPoles[0]?.lat,
        fault_lon: affectedPoles[0]?.lon,
        affected_poles: affectedPoles.map(p => p.pole_id),
        affected_pole_count: affectedPoles.length,
        estimated_households: affectedPoles.length * 4,
        confidence_label: 'HIGH',
        confidence_factors: { topology_source: 'surveyed', fault_type: type },
        topology_source: 'surveyed',
        span_distance_m: 42,
        total_dark_line_length_m: affectedPoles.length * 35,
        dt_distance_m: 0,
        priority_score: 200 + affectedPoles.length * 10,
        detected_at: new Date().toISOString(),
      }
      setTickets(prev => [newTicket, ...prev])
      addToast(`⚡ Demo Fault: ${newTicket.display_id}`, `${type} fault — ${affectedPoles.length} poles affected`, 'fault')
      return
    }

    try {
      if (type === 'span') {
        const poleId = targetId.startsWith('bp-') ? targetId.slice(3) : targetId
        await fetch(`${API_URL}/api/simulator/fault/span`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ dt_id: parentId, fault_after_pole: poleId })
        })
      } else if (type === 'dt') {
        const dtId = targetId.startsWith('bdt-') ? targetId.slice(4) : targetId
        await fetch(`${API_URL}/api/simulator/fault/dt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ dt_id: dtId })
        })
      }
      setTimeout(fetchData, 1000)
    } catch (err) {
      addToast('Error', err.message, 'fault')
    }
  }

  const handleRepairSinglePole = async (poleId) => {
    if (demoMode) {
      const cleanPoleId = poleId.startsWith('bp-') ? poleId.slice(3) : poleId
      setPoles(prev => prev.map(p => p.pole_id === cleanPoleId ? { ...p, status: 'live' } : p))
      addToast('✅ Repaired', `Pole ${cleanPoleId} restored`, 'success')
      return
    }
    try {
      const cleanPoleId = poleId.startsWith('bp-') ? poleId.slice(3) : poleId
      await fetch(`${API_URL}/api/simulator/repair/pole`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ pole_id: cleanPoleId })
      })
      setTimeout(fetchData, 1000)
    } catch (err) {
      addToast('Error', err.message, 'fault')
    }
  }

  const handleRepairAllAPI = async () => {
    if (demoMode) {
      setPoles(prev => prev.map(p => ({ ...p, status: 'live' })))
      setTickets(prev => prev.map(t => t.status !== 'verified' && t.status !== 'closed' ? { ...t, status: 'verified', verified_at: new Date().toISOString() } : t))
      addToast('✅ All Repaired', 'All poles restored, tickets verified', 'success')
      return
    }
    try {
      const res = await fetch(`${API_URL}/api/simulator/active-faults`)
      if (res.ok) {
        const faults = await res.json()
        const dtIds = [...new Set(faults.map(f => f.dt_id).filter(Boolean))]
        for (const dtId of dtIds) {
          await fetch(`${API_URL}/api/simulator/repair`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ dt_id: dtId })
          })
        }
        setTimeout(fetchData, 1000)
      }
    } catch (err) {
      addToast('Error', err.message, 'fault')
    }
  }

  // Layer & Filter toggles
  const handleToggleLayer = (layerKey) => {
    setLayers(prev => ({ ...prev, [layerKey]: !prev[layerKey] }))
  }

  const handleChangeFilter = (filterKey, value) => {
    setFilters(prev => ({ ...prev, [filterKey]: value }))
  }

  // Feeders and DT list for filters
  const feederList = useMemo(() => {
    const set = new Set()
    dts.forEach(d => { if (d.feeder_id) set.add(d.feeder_id) })
    poles.forEach(p => { if (p.feeder_id) set.add(p.feeder_id) })
    return Array.from(set).sort()
  }, [dts, poles])

  const activeTickets = tickets
    .filter(t => !['verified', 'closed'].includes(t.status))
    .sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0))
  const recentTickets = tickets.filter(t => ['verified', 'closed'].includes(t.status)).slice(0, 10)

  // If loading session
  if (authLoading) {
    return (
      <div className="login-overlay">
        <div style={{ textAlign: 'center', color: '#38bdf8', fontSize: 16 }}>
          ⚡ Initializing GridOps-AI Control Room...
        </div>
      </div>
    )
  }

  // If unauthenticated, show Control Room login modal
  if (!token || !user) {
    return <LoginModal onLoginSuccess={fetchData} />
  }

  return (
    <div className="app-layout">
      {/* Top Header */}
      <header className="app-header">
        <h1>
          <span className="icon">⚡</span>
          GridOps-AI
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 8 }}>
            Distribution Operations
          </span>
        </h1>

        <div className="header-status">
          <span>
            <span className={`status-dot ${connected ? 'live' : 'error'}`} />
            {connected ? (demoMode ? 'Demo Mode' : 'Live Stream') : 'Reconnecting...'}
          </span>
          {networkInfo && (
            <>
              <span>{networkInfo.poles} poles</span>
              <span>{networkInfo.dts} DTs</span>
              <span>{activeTickets.length} active faults</span>
            </>
          )}
          {demoMode && (
            <span className="provenance-badge provenance-inferred" title="Running with demo data — no backend connected" style={{ background: '#f59e0b22', color: '#f59e0b', border: '1px solid #f59e0b44' }}>
              ⚡ DEMO
            </span>
          )}
          <span className="provenance-badge provenance-imported" title="Source of truth network topology">
            SURVEYED
          </span>
        </div>

        {/* User Badge & Sign Out */}
        <div className="header-user">
          <div className="user-profile">
            <span className="user-avatar">
              {user.role === 'ADMIN' ? '🛡️' : user.role === 'OPERATOR' ? '🖥️' : '👷'}
            </span>
            <div className="user-info-text">
              <span className="user-name">{user.full_name || user.email}</span>
              <span className={`role-tag role-${user.role.toLowerCase()}`}>
                {user.role}
              </span>
            </div>
          </div>
          <button className="btn btn-logout" onClick={logout} title="Sign Out of Control Room">
            Sign Out
          </button>
        </div>
      </header>

      {/* Sidebar Navigation & Panels */}
      <div className="sidebar">
        <div className="sidebar-tabs" style={{ flexWrap: 'wrap', gap: 2 }}>
          {/* Tickets: all roles */}
          <button
            className={`sidebar-tab ${activeTab === 'tickets' ? 'active' : ''}`}
            onClick={() => setActiveTab('tickets')}
          >
            🎫 Tickets ({activeTickets.length})
          </button>

          {/* Dashboard: Operator & Admin */}
          {(isOperator || isAdmin) && (
            <button
              className={`sidebar-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
              onClick={() => setActiveTab('dashboard')}
            >
              📊 Dashboard
            </button>
          )}

          {/* Crews: Field Crew, Operator, Admin */}
          <button
            className={`sidebar-tab ${activeTab === 'crews' ? 'active' : ''}`}
            onClick={() => setActiveTab('crews')}
          >
            👷 {isFieldCrew ? 'My Incidents' : 'Crews'}
          </button>

          {/* Outages: Operator & Admin */}
          {(isOperator || isAdmin) && (
            <button
              className={`sidebar-tab ${activeTab === 'outages' ? 'active' : ''}`}
              onClick={() => setActiveTab('outages')}
            >
              📅 Outages
            </button>
          )}

          {/* Data: Operator & Admin */}
          {(isOperator || isAdmin) && (
            <button
              className={`sidebar-tab ${activeTab === 'data' ? 'active' : ''}`}
              onClick={() => setActiveTab('data')}
            >
              📤 Data
            </button>
          )}

          {/* Simulator: Operator & Admin */}
          {(isOperator || isAdmin) && (
            <button
              className={`sidebar-tab ${activeTab === 'simulator' ? 'active' : ''}`}
              onClick={() => setActiveTab('simulator')}
            >
              🔧 Simulator
            </button>
          )}

          {/* Audit Log: Admin only */}
          {isAdmin && (
            <button
              className={`sidebar-tab ${activeTab === 'audit' ? 'active' : ''}`}
              onClick={() => setActiveTab('audit')}
            >
              📜 Audit
            </button>
          )}

          {/* System Health: Operator & Admin */}
          {(isOperator || isAdmin) && (
            <button
              className={`sidebar-tab ${activeTab === 'health' ? 'active' : ''}`}
              onClick={() => setActiveTab('health')}
            >
              🩺 Health
            </button>
          )}
        </div>

        <div className="sidebar-content">
          {activeTab === 'tickets' ? (
            <TicketList
              tickets={activeTickets}
              recentTickets={recentTickets}
              selectedId={selectedTicket?.display_id}
              onSelect={(t) => {
                setSelectedTicket(t)
                setShowInvestigation(false)
              }}
            />
          ) : activeTab === 'dashboard' ? (
            <DashboardPanel apiUrl={API_URL} demoData={demoMode ? DEMO_ANALYTICS : null} />
          ) : activeTab === 'crews' ? (
            <CrewManagementPanel apiUrl={API_URL} onRefreshTickets={fetchData} demoData={demoMode ? DEMO_CREWS : null} />
          ) : activeTab === 'outages' ? (
            <OutageManagementPanel apiUrl={API_URL} demoData={demoMode ? DEMO_OUTAGES : null} />
          ) : activeTab === 'data' ? (
            <div>
              <div style={{ display: 'flex', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card)' }}>
                <button
                  className={`btn btn-xs ${dataSubMode === 'wizard' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDataSubMode('wizard')}
                >
                  🧙 CSV Import Wizard
                </button>
                <button
                  className={`btn btn-xs ${dataSubMode === 'uploader' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDataSubMode('uploader')}
                >
                  📦 Fast Seed Uploader
                </button>
              </div>
              {dataSubMode === 'wizard' ? (
                <CsvImportWizard apiUrl={API_URL} onImportSuccess={fetchData} />
              ) : (
                <DataLoaderPanel apiUrl={API_URL} />
              )}
            </div>
          ) : activeTab === 'audit' ? (
            <AuditLogPanel apiUrl={API_URL} demoData={demoMode ? DEMO_AUDIT_LOG : null} />
          ) : activeTab === 'health' ? (
            <SystemHealthPanel apiUrl={API_URL} demoData={demoMode ? DEMO_HEALTH : null} />
          ) : (
            <SimulatorPanel
              networkInfo={networkInfo}
              apiUrl={API_URL}
              onEvent={addToast}
              onRefresh={fetchData}
            />
          )}
        </div>
      </div>

      {/* Center Map Container */}
      <div className="map-container" style={{ position: 'relative' }}>
        {/* Map Top Bar Controls */}
        <MapControls
          layers={layers}
          onToggleLayer={handleToggleLayer}
          filters={filters}
          onChangeFilter={handleChangeFilter}
          feeders={feederList}
          dts={dts}
          selectedTicket={selectedTicket}
          onResetView={() => {
            setFilters({ feeder: '', dt: '', poleStatus: '', confidence: '' })
          }}
          onZoomToIncident={() => {
            if (selectedTicket) {
              setShowInvestigation(true)
            }
          }}
        />

        {/* Selected Feeder Overview Card */}
        {filters.feeder && (
          <FeederView
            feederId={filters.feeder}
            tickets={tickets}
            poles={poles}
            dts={dts}
            onClose={() => handleChangeFilter('feeder', '')}
          />
        )}

        {/* Dynamic Network Canvas */}
        <NetworkCanvas
          poles={poles}
          dts={dts}
          edges={edges}
          tickets={activeTickets}
          selectedTicket={selectedTicket}
          layers={layers}
          filters={filters}
          mapPreviewData={mapPreviewData}
          onInjectFault={handleInjectFault}
          onRepairSingle={handleRepairSinglePole}
          onRepairAll={handleRepairAllAPI}
        />

        {/* Incident Investigation Drawer OR Ticket Detail Panel */}
        {selectedTicket && (
          showInvestigation ? (
            <IncidentInvestigation
              ticket={selectedTicket}
              poles={poles}
              onClose={() => setShowInvestigation(false)}
              onTransition={handleTransition}
              onExplain={handleExplain}
              onAssignCrewClick={() => {
                setShowInvestigation(false)
                setActiveTab('crews')
              }}
            />
          ) : (
            <TicketDetail
              ticket={selectedTicket}
              onClose={() => setSelectedTicket(null)}
              onTransition={handleTransition}
              onExplain={handleExplain}
              onInvestigate={() => setShowInvestigation(true)}
            />
          )
        )}
      </div>

      <ToastContainer toasts={toasts} />
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider apiUrl={API_URL}>
      <MainApp />
    </AuthProvider>
  )
}
