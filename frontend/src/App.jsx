import { useState, useEffect, useCallback, useRef } from 'react'
import NetworkMap from './components/NetworkMap'
import NetworkCanvas from './components/NetworkCanvas'
import TicketList from './components/TicketList'
import TicketDetail from './components/TicketDetail'
import SimulatorPanel from './components/SimulatorPanel'
import ToastContainer from './components/ToastContainer'

const API_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:8000'
  : `${window.location.protocol}//${window.location.hostname}:8000`

function App() {
  const [tickets, setTickets] = useState([])
  const [selectedTicket, setSelectedTicket] = useState(null)
  const [poles, setPoles] = useState([])
  const [dts, setDts] = useState([])
  const [edges, setEdges] = useState([])
  const [networkInfo, setNetworkInfo] = useState(null)
  const [activeTab, setActiveTab] = useState('tickets')
  const [toasts, setToasts] = useState([])
  const [viewMode, setViewMode] = useState('canvas')
  const [connected, setConnected] = useState(false)
  const eventSourceRef = useRef(null)

  const addToast = useCallback((title, message, type = 'info') => {
    const id = Date.now()
    setToasts(prev => [...prev, { id, title, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 6000)
  }, [])

  // Fetch initial data
  const fetchData = useCallback(async () => {
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
  }, [])

  // SSE connection for real-time updates
  useEffect(() => {
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
            // Refresh poles to show updated state
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
        // Reconnect after 3s
        setTimeout(connectSSE, 3000)
      }

      eventSourceRef.current = es
    }

    connectSSE()
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  }, [addToast])

  useEffect(() => {
    fetchData()
    // Periodic refresh every 15s
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  const handleTransition = async (displayId, newStatus) => {
    try {
      const res = await fetch(`${API_URL}/api/tickets/${displayId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const data = await res.json()
      if (res.ok) {
        addToast('Ticket Updated', data.message, 'success')
        await fetchData()
        // Refresh selected ticket
        if (selectedTicket?.display_id === displayId) {
          const ticketRes = await fetch(`${API_URL}/api/tickets/${displayId}`)
          if (ticketRes.ok) setSelectedTicket(await ticketRes.json())
        }
      } else {
        addToast('Action Failed', data.detail, 'fault')
      }
    } catch (err) {
      addToast('Error', err.message, 'fault')
    }
  }

  const handleExplain = async (displayId) => {
    try {
      const res = await fetch(`${API_URL}/api/ai/explain/${displayId}`)
      if (res.ok) return await res.json()
    } catch (err) {
      console.error('Explain failed:', err)
    }
    return null
  }

  const activeTickets = tickets.filter(t => !['verified', 'closed'].includes(t.status))
  const recentTickets = tickets.filter(t => ['verified', 'closed'].includes(t.status)).slice(0, 10)

  return (
    <div className="app-layout">
      <header className="app-header">
        <h1>
          <span className="icon">⚡</span>
          Fault Localization System
        </h1>
        <div className="header-status">
          <div className="view-toggle">
            <button
              className={viewMode === 'canvas' ? 'active' : ''}
              onClick={() => setViewMode('canvas')}
            >
              🎨 Canvas
            </button>
            <button
              className={viewMode === 'map' ? 'active' : ''}
              onClick={() => setViewMode('map')}
            >
              🗺️ Map
            </button>
          </div>
          <span>
            <span className={`status-dot ${connected ? 'live' : 'error'}`} />
            {connected ? 'Live' : 'Reconnecting...'}
          </span>
          {networkInfo && (
            <>
              <span>{networkInfo.poles} poles</span>
              <span>{networkInfo.dts} DTs</span>
              <span>{activeTickets.length} active faults</span>
            </>
          )}
        </div>
      </header>

      <div className="sidebar">
        <div className="sidebar-tabs">
          <button
            className={`sidebar-tab ${activeTab === 'tickets' ? 'active' : ''}`}
            onClick={() => setActiveTab('tickets')}
          >
            🎫 Tickets ({activeTickets.length})
          </button>
          <button
            className={`sidebar-tab ${activeTab === 'simulator' ? 'active' : ''}`}
            onClick={() => setActiveTab('simulator')}
          >
            🔧 Simulator
          </button>
        </div>

        <div className="sidebar-content">
          {activeTab === 'tickets' ? (
            <TicketList
              tickets={activeTickets}
              recentTickets={recentTickets}
              selectedId={selectedTicket?.display_id}
              onSelect={(t) => setSelectedTicket(t)}
            />
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

      <div className="map-container">
        {viewMode === 'map' ? (
          <NetworkMap
            key="map-view"
            poles={poles}
            dts={dts}
            edges={edges}
            tickets={activeTickets}
            selectedTicket={selectedTicket}
            onPoleClick={(p) => console.log('Pole clicked:', p)}
          />
        ) : (
          <NetworkCanvas
            poles={poles}
            dts={dts}
            edges={edges}
            tickets={activeTickets}
            selectedTicket={selectedTicket}
          />
        )}

        {selectedTicket && (
          <TicketDetail
            ticket={selectedTicket}
            onClose={() => setSelectedTicket(null)}
            onTransition={handleTransition}
            onExplain={handleExplain}
          />
        )}
      </div>

      <ToastContainer toasts={toasts} />
    </div>
  )
}

export default App
