import { useState, useEffect, useCallback } from 'react'

function MissionPanel({ scenario, missions, progress, completionStats, role, onReset, onSwitchRole }) {
  const [collapsed, setCollapsed] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)

  useEffect(() => {
    if (completionStats?.allDone && !showCelebration) {
      setShowCelebration(true)
      setTimeout(() => setShowCelebration(false), 5000)
    }
  }, [completionStats?.allDone])

  if (!scenario || !missions) return null

  const roleLabels = {
    ADMIN: { emoji: '🛡️', title: 'Command Center', color: '#f59e0b' },
    OPERATOR: { emoji: '🖥️', title: 'Incident Response', color: '#3b82f6' },
    FIELD_CREW: { emoji: '👷', title: 'Field Response', color: '#10b981' },
  }

  const roleInfo = roleLabels[role] || roleLabels.OPERATOR
  const pct = completionStats ? Math.round((completionStats.completed / completionStats.total) * 100) : 0

  return (
    <>
      {/* Celebration overlay */}
      {showCelebration && (
        <div className="mission-celebration">
          <div className="mission-celebration-content">
            <div className="celebration-emoji">🎉</div>
            <h2>Mission Complete!</h2>
            <p>All {roleInfo.title} tasks completed successfully.</p>
            <div className="celebration-actions">
              <button className="btn btn-primary btn-sm" onClick={onSwitchRole}>
                🔄 Switch Role
              </button>
              <button className="btn btn-secondary btn-sm" onClick={onReset}>
                🔁 New Scenario
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mission Panel */}
      <div className={`mission-panel ${collapsed ? 'collapsed' : ''}`}>
        {/* Header — always visible */}
        <div className="mission-header" onClick={() => setCollapsed(!collapsed)}>
          <div className="mission-header-left">
            <span className="mission-scenario-icon">{scenario.template?.icon || '⚡'}</span>
            <div>
              <div className="mission-title">
                {roleInfo.emoji} {roleInfo.title}
              </div>
              <div className="mission-scenario-name">{scenario.template?.name || 'Active Scenario'}</div>
            </div>
          </div>
          <div className="mission-header-right">
            <div className="mission-progress-ring" style={{ '--pct': pct, '--ring-color': roleInfo.color }}>
              <span>{completionStats?.completed}/{completionStats?.total}</span>
            </div>
            <span className="mission-collapse-icon">{collapsed ? '▲' : '▼'}</span>
          </div>
        </div>

        {/* Body — collapsible */}
        {!collapsed && (
          <div className="mission-body">
            {/* Scenario description */}
            <div className="mission-scenario-desc">
              {scenario.template?.description}
            </div>

            {/* Impact stats */}
            <div className="mission-stats-row">
              <div className="mission-stat">
                <span className="mission-stat-value">{scenario.darkPoleCount}</span>
                <span className="mission-stat-label">Poles Dark</span>
              </div>
              <div className="mission-stat">
                <span className="mission-stat-value">{scenario.affectedDtCount}</span>
                <span className="mission-stat-label">DTs Hit</span>
              </div>
              <div className="mission-stat">
                <span className="mission-stat-value">~{scenario.totalHouseholds}</span>
                <span className="mission-stat-label">Households</span>
              </div>
              <div className="mission-stat">
                <span className={`mission-severity mission-severity-${(scenario.template?.severity || 'HIGH').toLowerCase()}`}>
                  {scenario.template?.severity || 'HIGH'}
                </span>
                <span className="mission-stat-label">Severity</span>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mission-progress-bar">
              <div className="mission-progress-fill" style={{ width: `${pct}%`, background: roleInfo.color }} />
            </div>

            {/* Task list */}
            <div className="mission-tasks">
              {missions.map(m => {
                const done = progress[m.id]?.done
                return (
                  <div key={m.id} className={`mission-task ${done ? 'done' : ''}`}>
                    <span className="mission-task-check">{done ? '✅' : '☐'}</span>
                    <span className="mission-task-icon">{m.icon}</span>
                    <span className="mission-task-label">{m.label}</span>
                  </div>
                )
              })}
            </div>

            {/* Actions */}
            <div className="mission-actions">
              <button className="btn btn-xs btn-secondary" onClick={onSwitchRole} title="Log out and switch to a different role">
                🔄 Switch Role
              </button>
              <button className="btn btn-xs btn-secondary" onClick={onReset} title="Generate a completely new incident scenario">
                🔁 New Scenario
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}

export default MissionPanel
