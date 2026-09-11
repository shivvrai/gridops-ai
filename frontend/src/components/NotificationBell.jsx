import { useState, useEffect, useRef, useCallback } from 'react'

const PRIORITY_CONFIG = {
  CRITICAL: { icon: '🔴', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', label: 'Critical' },
  HIGH:     { icon: '🟠', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', label: 'High' },
  MEDIUM:   { icon: '🔵', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', label: 'Medium' },
  LOW:      { icon: '⚪', color: '#6b7280', bg: 'rgba(107,114,128,0.12)', label: 'Low' },
}

const EVENT_ICONS = {
  ticket_created:  '⚡',
  ticket_updated:  '🔄',
  ticket_verified: '✅',
  device_anomaly:  '⚠️',
  crew_dispatched: '🚐',
}

function formatTimeAgo(ts) {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

export default function NotificationBell({ notifications, onClearAll, onMarkAllRead }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('all') // all, unread, critical
  const bellRef = useRef(null)
  const panelRef = useRef(null)
  const [animateBell, setAnimateBell] = useState(false)
  const prevCount = useRef(notifications.length)

  // Animate bell icon on new notification
  useEffect(() => {
    if (notifications.length > prevCount.current) {
      setAnimateBell(true)
      setTimeout(() => setAnimateBell(false), 600)
    }
    prevCount.current = notifications.length
  }, [notifications.length])

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        bellRef.current && !bellRef.current.contains(e.target)
      ) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const unreadCount = notifications.filter(n => !n.read).length
  const criticalCount = notifications.filter(n => n.priority === 'CRITICAL' || n.priority === 'HIGH').length

  const filtered = notifications.filter(n => {
    if (filter === 'unread') return !n.read
    if (filter === 'critical') return n.priority === 'CRITICAL' || n.priority === 'HIGH'
    return true
  })

  return (
    <div className="notification-bell-wrapper">
      <button
        ref={bellRef}
        className={`notification-bell-btn ${animateBell ? 'ring' : ''} ${unreadCount > 0 ? 'has-unread' : ''}`}
        onClick={() => setOpen(!open)}
        title="Notifications (Observer Pattern)"
      >
        <span className="bell-icon">🔔</span>
        {unreadCount > 0 && (
          <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {open && (
        <div ref={panelRef} className="notification-panel">
          <div className="notification-panel-header">
            <h3>
              🔔 Notifications
              <span className="notification-count">{notifications.length}</span>
            </h3>
            <div className="notification-header-actions">
              {unreadCount > 0 && (
                <button className="notif-action-btn" onClick={onMarkAllRead} title="Mark all as read">
                  ✓ Read All
                </button>
              )}
              {notifications.length > 0 && (
                <button className="notif-action-btn" onClick={onClearAll} title="Clear all notifications">
                  🗑️ Clear
                </button>
              )}
            </div>
          </div>

          <div className="notification-filters">
            {['all', 'unread', 'critical'].map(f => (
              <button
                key={f}
                className={`notif-filter-btn ${filter === f ? 'active' : ''}`}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? `All (${notifications.length})` :
                 f === 'unread' ? `Unread (${unreadCount})` :
                 `🔴 Critical (${criticalCount})`}
              </button>
            ))}
          </div>

          <div className="notification-list">
            {filtered.length === 0 ? (
              <div className="notification-empty">
                <span className="notification-empty-icon">🔕</span>
                <p>No notifications</p>
                <p className="notification-empty-sub">Grid events from the Observer hub appear here in real time</p>
              </div>
            ) : (
              filtered.map((notif, i) => {
                const pConfig = PRIORITY_CONFIG[notif.priority] || PRIORITY_CONFIG.MEDIUM
                const eventIcon = EVENT_ICONS[notif.event_type] || '📌'
                return (
                  <div
                    key={notif.id || i}
                    className={`notification-item ${!notif.read ? 'unread' : ''}`}
                    style={{ borderLeftColor: pConfig.color }}
                  >
                    <div className="notif-icon-col">
                      <span className="notif-event-icon">{eventIcon}</span>
                    </div>
                    <div className="notif-content-col">
                      <div className="notif-top-row">
                        <span className="notif-type">{notif.event_type.replace(/_/g, ' ')}</span>
                        <span className="notif-priority-pill" style={{ background: pConfig.bg, color: pConfig.color }}>
                          {pConfig.icon} {pConfig.label}
                        </span>
                      </div>
                      <div className="notif-message">{notif.message}</div>
                      <div className="notif-meta">
                        <span className="notif-time">{formatTimeAgo(notif.timestamp)}</span>
                        {notif.displayId && <span className="notif-ticket-tag">{notif.displayId}</span>}
                      </div>
                    </div>
                    {!notif.read && <span className="notif-unread-dot" />}
                  </div>
                )
              })
            )}
          </div>

          <div className="notification-panel-footer">
            <span className="notif-observer-tag">⚙️ Powered by Observer Design Pattern</span>
          </div>
        </div>
      )}
    </div>
  )
}
