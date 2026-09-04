import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

function CrewManagementPanel({ apiUrl, onRefreshTickets, selectedTicketForAssign, onAssignmentDone }) {
  const { user, isFieldCrew, isAdmin, authFetch } = useAuth()
  const [crews, setCrews] = useState([])
  const [myIncidents, setMyIncidents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddCrew, setShowAddCrew] = useState(false)
  const [newCrew, setNewCrew] = useState({ crew_id: '', name: '', lead_name: '', contact: '', base_station: '' })
  const [fieldNotesInput, setFieldNotesInput] = useState({})
  const [assignCrewId, setAssignCrewId] = useState('')
  const [assignNotes, setAssignNotes] = useState('')

  const fetchCrews = useCallback(async () => {
    try {
      const res = await authFetch(`${apiUrl}/api/crews/`)
      if (res.ok) setCrews(await res.json())
    } catch (err) {
      console.error('Failed to fetch crews:', err)
    }
  }, [apiUrl, authFetch])

  const fetchMyIncidents = useCallback(async () => {
    try {
      const res = await authFetch(`${apiUrl}/api/crews/my-incidents`)
      if (res.ok) setMyIncidents(await res.json())
    } catch (err) {
      console.error('Failed to fetch incidents:', err)
    }
  }, [apiUrl, authFetch])

  useEffect(() => {
    setLoading(true)
    Promise.all([fetchCrews(), fetchMyIncidents()]).finally(() => setLoading(false))
  }, [fetchCrews, fetchMyIncidents])

  const handleCreateCrew = async (e) => {
    e.preventDefault()
    if (!newCrew.crew_id || !newCrew.name || !newCrew.lead_name) return
    try {
      const res = await authFetch(`${apiUrl}/api/crews/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCrew),
      })
      if (res.ok) {
        setShowAddCrew(false)
        setNewCrew({ crew_id: '', name: '', lead_name: '', contact: '', base_station: '' })
        await fetchCrews()
      }
    } catch (err) {
      alert(err.message)
    }
  }

  const handleAssignSubmit = async (e) => {
    e.preventDefault()
    if (!selectedTicketForAssign || !assignCrewId) return
    try {
      const res = await authFetch(`${apiUrl}/api/crews/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket_display_id: selectedTicketForAssign.display_id,
          crew_id: assignCrewId,
          notes: assignNotes,
        }),
      })
      if (res.ok) {
        if (onRefreshTickets) onRefreshTickets()
        if (onAssignmentDone) onAssignmentDone()
        await fetchCrews()
        await fetchMyIncidents()
      }
    } catch (err) {
      alert(err.message)
    }
  }

  const handleFieldStageUpdate = async (displayId, stage) => {
    const notes = fieldNotesInput[displayId] || ''
    try {
      const res = await authFetch(`${apiUrl}/api/crews/incidents/${displayId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, field_notes: notes }),
      })
      if (res.ok) {
        setFieldNotesInput(prev => ({ ...prev, [displayId]: '' }))
        await fetchMyIncidents()
        if (onRefreshTickets) onRefreshTickets()
      }
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div className="crew-management-container">
      {/* If an assignment is in progress from TicketDetail/Investigation */}
      {selectedTicketForAssign && (
        <div className="dash-card" style={{ borderLeft: '3px solid #3b82f6', marginBottom: 14 }}>
          <div className="dash-card-header">
            <span className="dash-card-icon">👷</span>
            <span className="dash-card-title">Assign Crew to {selectedTicketForAssign.display_id}</span>
          </div>
          <form onSubmit={handleAssignSubmit} style={{ padding: '8px 0' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <select
                value={assignCrewId}
                onChange={(e) => setAssignCrewId(e.target.value)}
                style={{ flex: 1, padding: '6px 8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
                required
              >
                <option value="">Select Maintenance Crew...</option>
                {crews.map((c) => (
                  <option key={c.crew_id} value={c.crew_id}>
                    {c.crew_id} - {c.name} ({c.status})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <input
                type="text"
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                placeholder="Dispatch instructions or safety notes..."
                style={{ width: '100%', padding: '6px 8px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)', borderRadius: 4 }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-sm btn-primary">
                Confirm Dispatch
              </button>
              <button type="button" className="btn btn-sm btn-secondary" onClick={onAssignmentDone}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* FIELD CREW VIEW: MY INCIDENTS */}
      {isFieldCrew && (
        <div className="dash-card" style={{ marginBottom: 14 }}>
          <div className="dash-card-header">
            <span className="dash-card-icon">📋</span>
            <span className="dash-card-title">MY ASSIGNED INCIDENTS</span>
            <span className="provenance-badge provenance-imported">FIELD CREW</span>
          </div>

          {myIncidents.length === 0 ? (
            <div style={{ padding: 12, color: 'var(--text-muted)', fontSize: 11 }}>
              No incidents currently assigned to your crew.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
              {myIncidents.map((inc) => (
                <div key={inc.ticket_id} className="field-incident-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 13 }}>{inc.display_id}</span>
                    <span className={`ticket-badge badge-${inc.status}`}>{inc.status}</span>
                  </div>

                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', margin: '4px 0' }}>
                    <strong>{inc.fault_type.toUpperCase()} FAULT</strong> · Feeder {inc.feeder_id} · DT {inc.dt_id || 'N/A'}
                  </div>

                  {inc.fault_lat && inc.fault_lon && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      📍 GPS: {inc.fault_lat.toFixed(5)}°N, {inc.fault_lon.toFixed(5)}°E ({inc.pincode || 'Area'})
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: '#ef4444', margin: '4px 0' }}>
                    ⚠️ Affected: {inc.affected_pole_count} poles
                  </div>

                  {/* Field Actions */}
                  <div className="field-actions-row">
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={() => handleFieldStageUpdate(inc.display_id, 'arrived')}
                      disabled={inc.status === 'resolved' || inc.status === 'verified'}
                    >
                      🚗 Arrived On Site
                    </button>
                    <button
                      className="btn btn-xs btn-secondary"
                      onClick={() => handleFieldStageUpdate(inc.display_id, 'repair_started')}
                      disabled={inc.status === 'resolved' || inc.status === 'verified'}
                    >
                      🔧 Repair Started
                    </button>
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => handleFieldStageUpdate(inc.display_id, 'repair_completed')}
                      disabled={inc.status === 'resolved' || inc.status === 'verified'}
                    >
                      ✅ Repair Completed
                    </button>
                  </div>

                  {/* Field notes input */}
                  <div style={{ marginTop: 6 }}>
                    <input
                      type="text"
                      placeholder="Add lineman notes (e.g. replaced jumper)..."
                      value={fieldNotesInput[inc.display_id] || ''}
                      onChange={(e) => setFieldNotesInput({ ...fieldNotesInput, [inc.display_id]: e.target.value })}
                      style={{ width: '100%', fontSize: 10, padding: '4px 6px', background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-primary)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ADMIN & OPERATOR: CREW ROSTER */}
      <div className="dash-card">
        <div className="dash-card-header">
          <span className="dash-card-icon">👷</span>
          <span className="dash-card-title">Maintenance Crews Roster</span>
          {isAdmin && (
            <button
              className="btn btn-xs btn-secondary"
              onClick={() => setShowAddCrew(!showAddCrew)}
            >
              {showAddCrew ? '✕ Cancel' : '+ Add Crew'}
            </button>
          )}
        </div>

        {showAddCrew && (
          <form onSubmit={handleCreateCrew} style={{ background: 'var(--bg-secondary)', padding: 10, borderRadius: 6, margin: '8px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <input
                type="text"
                placeholder="Crew ID (e.g. CREW-04)"
                value={newCrew.crew_id}
                onChange={(e) => setNewCrew({ ...newCrew, crew_id: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder="Crew Name"
                value={newCrew.name}
                onChange={(e) => setNewCrew({ ...newCrew, name: e.target.value })}
                required
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
              <input
                type="text"
                placeholder="Lead Lineman Name"
                value={newCrew.lead_name}
                onChange={(e) => setNewCrew({ ...newCrew, lead_name: e.target.value })}
                required
              />
              <input
                type="text"
                placeholder="Contact Phone"
                value={newCrew.contact}
                onChange={(e) => setNewCrew({ ...newCrew, contact: e.target.value })}
                required
              />
            </div>
            <button type="submit" className="btn btn-xs btn-primary">Save Crew</button>
          </form>
        )}

        <div className="crew-list">
          {crews.map((c) => (
            <div key={c.crew_id} className="crew-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{c.crew_id}: {c.name}</span>
                <span className={`status-pill ${c.status === 'available' ? 'status-pill-healthy' : 'status-pill-fault'}`}>
                  {c.status}
                </span>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                Lead: <strong>{c.lead_name}</strong> · Contact: {c.contact} · Base: {c.base_station || 'Central Depot'}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default CrewManagementPanel
