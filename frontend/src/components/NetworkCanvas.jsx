import { useRef, useState, useEffect, useCallback } from 'react'

/* ================================================================
   CONSTANTS
   ================================================================ */

const COLORS = {
  bg: '#0f1117',
  grid: 'rgba(255,255,255,0.03)',
  gridMajor: 'rgba(255,255,255,0.06)',
  selection: '#fbbf24',
  multiSelect: '#38bdf8',
  wirePreview: 'rgba(251,191,36,0.8)',
  lasso: 'rgba(56,189,248,0.15)',
  lassoBorder: 'rgba(56,189,248,0.6)',
  substation: { fill: '#7c3aed', glow: 'rgba(124,58,237,0.35)', stroke: '#a78bfa' },
  dt: { fill: '#3b82f6', glow: 'rgba(59,130,246,0.25)', stroke: '#93c5fd' },
  pole: {
    live: '#22c55e', dark: '#ef4444', suspected_dark: '#f59e0b',
    unknown: '#6b7280', confirmed_dark: '#ef4444', device_dead: '#4b5563',
  },
  home: { fill: '#f97316', stroke: '#fdba74' },
  edge: {
    feeder:       { c: '#a78bfa', w: 3.5 },
    lt_line:      { c: '#60a5fa', w: 2.5 },
    span:         { c: '#4ade80', w: 2 },
    service_drop: { c: '#fb923c', w: 1.5 },
  },
  fault: '#ef4444',
  faultGlow: 'rgba(239,68,68,0.4)',
  boundary: '#fbbf24',
}

const SIZES = { substation: 20, dt: 16, pole: 8, home: 7 }

const MODES = [
  { id: 'select',   icon: '👆', label: 'Select',  cursor: 'default' },
  { id: 'addPole',  icon: '⬤',  label: 'Pole',    cursor: 'crosshair' },
  { id: 'addDT',    icon: '⬜', label: 'DT',      cursor: 'crosshair' },
  { id: 'addHome',  icon: '🏠', label: 'Home',    cursor: 'crosshair' },
  { id: 'addWire',  icon: '🔗', label: 'Wire',    cursor: 'crosshair' },
  { id: 'addFault', icon: '⚡', label: 'Fault',   cursor: 'crosshair' },
  { id: 'delete',   icon: '✕',  label: 'Delete',  cursor: 'pointer' },
]

/* ================================================================
   GEOMETRY HELPERS
   ================================================================ */

const toWorld = (sx, sy, t) => ({
  x: (sx - t.x) / t.scale,
  y: (sy - t.y) / t.scale,
})

const toScreen = (wx, wy, t) => ({
  x: wx * t.scale + t.x,
  y: wy * t.scale + t.y,
})

function hitNode(wx, wy, nodes) {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i], r = (SIZES[n.type] || 8) + 6
    if ((wx - n.x) ** 2 + (wy - n.y) ** 2 <= r * r) return n
  }
  return null
}

function hitEdge(wx, wy, edges, nodeMap) {
  for (const e of edges) {
    const a = nodeMap[e.from], b = nodeMap[e.to]
    if (!a || !b) continue
    const dx = b.x - a.x, dy = b.y - a.y, lsq = dx * dx + dy * dy
    if (lsq === 0) continue
    const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / lsq))
    if (Math.sqrt((wx - (a.x + t * dx)) ** 2 + (wy - (a.y + t * dy)) ** 2) <= 10) return e
  }
  return null
}

function autoEdgeType(a, b) {
  if (a.type === 'substation' || b.type === 'substation') return 'feeder'
  if (a.type === 'dt' || b.type === 'dt') return 'lt_line'
  if (a.type === 'home' || b.type === 'home') return 'service_drop'
  return 'span'
}

function nodesInRect(nodes, x1, y1, x2, y2) {
  const minX = Math.min(x1, x2), maxX = Math.max(x1, x2)
  const minY = Math.min(y1, y2), maxY = Math.max(y1, y2)
  return nodes.filter(n => n.x >= minX && n.x <= maxX && n.y >= minY && n.y <= maxY)
}

/* ================================================================
   DRAWING
   ================================================================ */

function drawGrid(ctx, w, h, t) {
  const gs = 40, { x: ox, y: oy, scale: s } = t
  const sx = Math.floor(-ox / s / gs) * gs, sy = Math.floor(-oy / s / gs) * gs
  const ex = sx + w / s + gs * 2, ey = sy + h / s + gs * 2

  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 0.5 / s
  ctx.beginPath()
  for (let x = sx; x <= ex; x += gs) { ctx.moveTo(x, sy); ctx.lineTo(x, ey) }
  for (let y = sy; y <= ey; y += gs) { ctx.moveTo(sx, y); ctx.lineTo(ex, y) }
  ctx.stroke()

  const mg = gs * 5, msx = Math.floor(-ox / s / mg) * mg, msy = Math.floor(-oy / s / mg) * mg
  ctx.strokeStyle = COLORS.gridMajor
  ctx.lineWidth = 1 / s
  ctx.beginPath()
  for (let x = msx; x <= ex; x += mg) { ctx.moveTo(x, sy); ctx.lineTo(x, ey) }
  for (let y = msy; y <= ey; y += mg) { ctx.moveTo(sx, y); ctx.lineTo(ex, y) }
  ctx.stroke()
}

function drawEdgeLine(ctx, e, a, b, flow, time, isMultiSel) {
  if (!a || !b) return
  const st = COLORS.edge[e.type] || COLORS.edge.span
  const isFault = e.status === 'fault'

  // Multi-select highlight
  if (isMultiSel) {
    ctx.save()
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = COLORS.multiSelect; ctx.lineWidth = st.w + 6
    ctx.globalAlpha = 0.25; ctx.stroke()
    ctx.restore()
  }

  // Glow layer for fault
  if (isFault) {
    ctx.save()
    ctx.shadowColor = COLORS.faultGlow
    ctx.shadowBlur = 14 + Math.sin(time * 0.05) * 5
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
    ctx.strokeStyle = COLORS.fault; ctx.lineWidth = st.w + 3; ctx.stroke()
    ctx.restore()
  }

  // Main line
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
  ctx.strokeStyle = isFault ? COLORS.fault : st.c
  ctx.lineWidth = st.w
  if (e.type === 'service_drop') ctx.setLineDash([5, 4])
  ctx.stroke()
  ctx.setLineDash([])

  // Fault X marker
  if (isFault) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const sz = 9 + Math.sin(time * 0.08) * 2
    ctx.save()
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(mx - sz, my - sz); ctx.lineTo(mx + sz, my + sz)
    ctx.moveTo(mx + sz, my - sz); ctx.lineTo(mx - sz, my + sz)
    ctx.stroke()
    ctx.restore()
  }

  // Flow dots (live edges only)
  const darkStatuses = ['dark', 'confirmed_dark']
  if (!isFault && !darkStatuses.includes(a.status) && !darkStatuses.includes(b.status)) {
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.sqrt(dx * dx + dy * dy)
    if (len < 20) return
    const dots = Math.max(1, Math.floor(len / 55))
    ctx.save(); ctx.globalAlpha = 0.55
    for (let i = 0; i < dots; i++) {
      const t = ((flow / len + i / dots) % 1 + 1) % 1
      ctx.beginPath()
      ctx.arc(a.x + dx * t, a.y + dy * t, 2.2, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'; ctx.fill()
    }
    ctx.restore()
  }
}

function drawNode(ctx, n, isSel, isMultiSel, isBound, time) {
  const { x, y, type, status } = n
  const sz = SIZES[type]

  // Multi-select ring
  if (isMultiSel) {
    ctx.save()
    ctx.beginPath(); ctx.arc(x, y, sz + 11, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.multiSelect; ctx.lineWidth = 2.5
    ctx.globalAlpha = 0.6
    ctx.stroke()
    ctx.restore()
  }

  // Selection ring
  if (isSel) {
    ctx.save()
    ctx.beginPath(); ctx.arc(x, y, sz + 9, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.selection; ctx.lineWidth = 2.5
    ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([])
    ctx.restore()
  }

  // Boundary glow
  if (isBound) {
    ctx.save()
    ctx.shadowColor = 'rgba(251,191,36,0.6)'
    ctx.shadowBlur = 14 + Math.sin(time * 0.06) * 5
    ctx.beginPath(); ctx.arc(x, y, sz + 11, 0, Math.PI * 2)
    ctx.strokeStyle = COLORS.boundary; ctx.lineWidth = 3; ctx.stroke()
    ctx.restore()
  }

  // Faulted pole/node visual indicator
  if (n.isFault) {
    ctx.save()
    ctx.shadowColor = 'rgba(239, 68, 68, 0.85)'
    ctx.shadowBlur = 16 + Math.sin(time * 0.08) * 6
    ctx.beginPath(); ctx.arc(x, y, sz + 6, 0, Math.PI * 2)
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2.5; ctx.stroke()
    ctx.restore()

    // Blinking red fault badge
    ctx.save()
    ctx.fillStyle = '#ef4444'
    ctx.beginPath(); ctx.arc(x + sz + 3, y - sz - 3, 7, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('×', x + sz + 3, y - sz - 3)
    ctx.restore()
  }

  ctx.save()
  switch (type) {
    case 'substation': {
      ctx.shadowColor = COLORS.substation.glow
      ctx.shadowBlur = 18 + Math.sin(time * 0.03) * 4
      ctx.beginPath()
      ctx.moveTo(x, y - sz); ctx.lineTo(x + sz, y)
      ctx.lineTo(x, y + sz); ctx.lineTo(x - sz, y); ctx.closePath()
      const g = ctx.createRadialGradient(x, y, 0, x, y, sz)
      g.addColorStop(0, '#c4b5fd'); g.addColorStop(1, '#7c3aed')
      ctx.fillStyle = g; ctx.fill()
      ctx.strokeStyle = COLORS.substation.stroke; ctx.lineWidth = 2; ctx.stroke()
      break
    }
    case 'dt': {
      ctx.shadowColor = COLORS.dt.glow
      ctx.shadowBlur = 10 + Math.sin(time * 0.04) * 3
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(x - sz, y - sz, sz * 2, sz * 2, 5)
      else ctx.rect(x - sz, y - sz, sz * 2, sz * 2)
      const g = ctx.createRadialGradient(x, y, 0, x, y, sz * 1.3)
      g.addColorStop(0, '#93c5fd'); g.addColorStop(1, '#3b82f6')
      ctx.fillStyle = g; ctx.fill()
      ctx.strokeStyle = COLORS.dt.stroke; ctx.lineWidth = 1.5; ctx.stroke()
      // Icon
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${sz}px sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('⚡', x, y + 1)
      break
    }
    case 'pole': {
      const clr = COLORS.pole[status] || COLORS.pole.unknown
      if (status === 'dark' || status === 'confirmed_dark') {
        ctx.shadowColor = 'rgba(239,68,68,0.35)'; ctx.shadowBlur = 8
      } else if (status === 'live') {
        ctx.shadowColor = 'rgba(34,197,94,0.2)'; ctx.shadowBlur = 4
      }
      ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2)
      ctx.fillStyle = clr; ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke()
      break
    }
    case 'home': {
      ctx.shadowColor = 'rgba(249,115,22,0.25)'; ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.moveTo(x, y - sz * 1.5)
      ctx.lineTo(x - sz * 1.1, y - sz * 0.2)
      ctx.lineTo(x + sz * 1.1, y - sz * 0.2)
      ctx.closePath()
      ctx.fillStyle = '#ea580c'; ctx.fill()
      ctx.fillStyle = COLORS.home.fill
      ctx.fillRect(x - sz * 0.8, y - sz * 0.2, sz * 1.6, sz * 1.2)
      ctx.fillStyle = '#9a3412'
      ctx.fillRect(x - sz * 0.2, y + sz * 0.15, sz * 0.4, sz * 0.8)
      break
    }
  }
  ctx.restore()

  // Label
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.8)'
  const fs = type === 'substation' ? 11 : type === 'dt' ? 10 : 9
  ctx.font = `500 ${fs}px Inter, system-ui, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  ctx.fillText(n.label, x, y + sz + 5)
  ctx.restore()
}

function drawLasso(ctx, lasso, transform) {
  if (!lasso) return
  // lasso coords are in world space
  const { x1, y1, x2, y2 } = lasso
  ctx.save()
  ctx.fillStyle = COLORS.lasso
  ctx.strokeStyle = COLORS.lassoBorder
  ctx.lineWidth = 1.5 / transform.scale
  ctx.setLineDash([6 / transform.scale, 4 / transform.scale])
  const rx = Math.min(x1, x2), ry = Math.min(y1, y2)
  const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1)
  ctx.fillRect(rx, ry, rw, rh)
  ctx.strokeRect(rx, ry, rw, rh)
  ctx.setLineDash([])
  ctx.restore()
}

/* ================================================================
   RANDOM NETWORK GENERATOR
   ================================================================ */

function genNetwork(W, H) {
  const N = [], E = []
  let ni = 0, ei = 0, pn = 0, dn = 0, hn = 0
  const nid = () => `n${ni++}`
  const eid = () => `e${ei++}`

  const ssId = nid()
  N.push({ id: ssId, type: 'substation', x: W / 2, y: 60, label: 'SS-01', status: 'live' })

  const fCount = 2 + (Math.random() > 0.5 ? 1 : 0)
  const fSpacing = W * 0.65 / fCount

  for (let f = 0; f < fCount; f++) {
    const fx = W * 0.18 + fSpacing * (f + 0.5)
    const dtCount = 2 + Math.floor(Math.random() * 3)
    let prev = ssId

    for (let d = 0; d < dtCount; d++) {
      dn++
      const dtId = nid()
      const dtX = fx + (Math.random() - 0.5) * 80
      const dtY = 140 + d * ((H - 220) / dtCount) + (Math.random() - 0.5) * 20
      N.push({ id: dtId, type: 'dt', x: dtX, y: dtY, label: `DT-${String(dn).padStart(2, '0')}`, status: 'live' })
      E.push({ id: eid(), from: prev, to: dtId, type: prev === ssId ? 'feeder' : 'lt_line', status: 'live' })
      prev = dtId

      // Main pole line
      const mainLen = 4 + Math.floor(Math.random() * 6)
      const dir = f < fCount / 2 ? -1 : 1
      const sp = 32 + Math.random() * 18
      let pp = dtId
      const dtPoles = []

      for (let p = 0; p < mainLen; p++) {
        pn++
        const pid = nid()
        N.push({
          id: pid, type: 'pole',
          x: dtX + dir * sp * (p + 1) + (Math.random() - 0.5) * 10,
          y: dtY + (Math.random() - 0.5) * 20,
          label: `P-${String(pn).padStart(3, '0')}`, status: 'live',
        })
        E.push({ id: eid(), from: pp, to: pid, type: 'span', status: 'live' })
        dtPoles.push(pid)
        pp = pid
      }

      // Spur/branch
      if (dtPoles.length > 3) {
        const bi = Math.floor(dtPoles.length * 0.3 + Math.random() * dtPoles.length * 0.4)
        const bNode = N.find(n => n.id === dtPoles[bi])
        if (bNode) {
          const brLen = 2 + Math.floor(Math.random() * 2)
          let bp = dtPoles[bi]
          const spurDir = Math.random() > 0.5 ? 1 : -1
          for (let b = 0; b < brLen; b++) {
            pn++
            const bid = nid()
            N.push({
              id: bid, type: 'pole',
              x: bNode.x + (Math.random() - 0.5) * 20,
              y: bNode.y + spurDir * (b + 1) * (28 + Math.random() * 12),
              label: `P-${String(pn).padStart(3, '0')}`, status: 'live',
            })
            E.push({ id: eid(), from: bp, to: bid, type: 'span', status: 'live' })
            dtPoles.push(bid)
            bp = bid
          }
        }
      }

      // Homes
      const hc = 1 + Math.floor(Math.random() * 3)
      for (let h = 0; h < hc && h < dtPoles.length; h++) {
        const pid = dtPoles[dtPoles.length - 1 - h]
        const pNode = N.find(n => n.id === pid)
        if (!pNode) continue
        hn++
        const hid = nid()
        N.push({
          id: hid, type: 'home',
          x: pNode.x + 12 + Math.random() * 20,
          y: pNode.y + 18 + Math.random() * 14,
          label: `H-${String(hn).padStart(2, '0')}`, status: 'live',
        })
        E.push({ id: eid(), from: pid, to: hid, type: 'service_drop', status: 'live' })
      }
    }
  }
  return { nodes: N, edges: E }
}

/* ================================================================
   FAULT INJECTION & SOLVER
   ================================================================ */

/** Inject a single new fault on a random un-faulted span edge */
function injectFault(nodes, edges) {
  const spans = edges.filter(e => e.type === 'span' && e.status !== 'fault')
  if (!spans.length) return { nodes, edges, faultId: null }
  const fe = spans[Math.floor(Math.random() * spans.length)]

  const newEdges = edges.map(e => ({ ...e, status: e.id === fe.id ? 'fault' : e.status }))
  const newNodes = rederiveStatuses(nodes, newEdges)

  return { nodes: newNodes, edges: newEdges, faultId: fe.id }
}

/** BFS from substations over non-fault edges to derive live/dark statuses */
function rederiveStatuses(nodes, edges) {
  const adj = {}
  const nMap = {}
  nodes.forEach(n => { adj[n.id] = []; nMap[n.id] = n })
  edges.forEach(e => {
    if (e.status !== 'fault') {
      if (adj[e.from]) adj[e.from].push(e.to)
      if (adj[e.to]) adj[e.to].push(e.from)
    }
  })

  const ss = nodes.filter(n => n.type === 'substation')
  const live = new Set()
  const q = []
  ss.forEach(s => { live.add(s.id); q.push(s.id) })

  while (q.length) {
    const c = q.shift()
    const cNode = nMap[c]
    // Power cannot traverse through a faulted pole or transformer
    if (cNode && cNode.isFault) continue
    for (const nb of (adj[c] || [])) {
      const nbNode = nMap[nb]
      if (nbNode && !nbNode.isFault && !live.has(nb)) {
        live.add(nb); q.push(nb)
      }
    }
  }

  return nodes.map(n => ({
    ...n,
    status: n.isFault ? 'confirmed_dark' : (live.has(n.id) ? 'live' : (Math.random() < 0.3 ? 'unknown' : 'dark')),
  }))
}

function solveFault(nodes, edges) {
  const children = {}
  nodes.forEach(n => { children[n.id] = [] })
  edges.forEach(e => { if (children[e.from]) children[e.from].push({ nid: e.to, eid: e.id }) })

  const ss = nodes.find(n => n.type === 'substation')
  if (!ss) return []

  const bounds = []
  const dfs = (id) => {
    const node = nodes.find(n => n.id === id)
    if (!node) return
    for (const ch of (children[id] || [])) {
      const cn = nodes.find(n => n.id === ch.nid)
      if (!cn) continue
      if (node.status === 'live' && cn.status !== 'live') {
        bounds.push({ live: id, dark: ch.nid, edge: ch.eid, isNodeFault: !!cn.isFault })
      } else {
        dfs(ch.nid)
      }
    }
  }
  dfs(ss.id)
  return bounds
}

/* ================================================================
   COMPONENT
   ================================================================ */

export default function NetworkCanvas({
  poles, dts, edges: initialEdges, tickets, selectedTicket,
  onInjectFault, onRepairSingle, onRepairAll,
  layers, filters, mapPreviewData,
}) {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const importedRef = useRef(false)

  const [mode, setMode] = useState('select')
  const [nodes, setNodes] = useState([])
  const [edges, setEdges] = useState([])
  const [selected, setSelected] = useState(null)           // single primary selection
  const [selectedSet, setSelectedSet] = useState(new Set()) // multi-select set of IDs
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [wireStart, setWireStart] = useState(null)
  const [mouseWorld, setMouseWorld] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(null)
  const [panStart, setPanStart] = useState(null)
  const [lasso, setLasso] = useState(null) // { x1, y1, x2, y2 } world coords
  const [boundaries, setBoundaries] = useState([])
  const [counters, setCounters] = useState({ pole: 0, dt: 0, home: 0 })
  const [faultIds, setFaultIds] = useState(new Set())
  const [showStudy, setShowStudy] = useState(false)
  const [studyTab, setStudyTab] = useState('overview')
  const [solveSteps, setSolveSteps] = useState([])
  const [currentStep, setCurrentStep] = useState(-1)
  const [highlightNodes, setHighlightNodes] = useState(new Set())
  const [highlightEdges, setHighlightEdges] = useState(new Set())

  // Master ref — read by animation loop & handlers without stale closures
  const S = useRef({})
  S.current = {
    mode, nodes, edges, transform, selected, selectedSet, wireStart,
    mouseWorld, boundaries, counters, dragging, panStart, lasso, faultIds,
    highlightNodes, highlightEdges, layers, filters, mapPreviewData,
  }

  /* ---- Canvas sizing ---- */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const resize = () => {
      const c = canvasRef.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      const r = el.getBoundingClientRect()
      c.width = r.width * dpr; c.height = r.height * dpr
      c.style.width = r.width + 'px'; c.style.height = r.height + 'px'
    }
    const obs = new ResizeObserver(resize)
    obs.observe(el); resize()
    return () => obs.disconnect()
  }, [])

  /* ---- Generate random network on mount ---- */
  useEffect(() => {
    const r = containerRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    const { nodes: nn, edges: ne } = genNetwork(r.width, r.height)
    setNodes(nn); setEdges(ne); setBoundaries([]); setFaultIds(new Set()); setSelected(null); setSelectedSet(new Set())
    setTransform({ x: 0, y: 0, scale: 1 })
    setCounters({ pole: nn.filter(n => n.type === 'pole').length, dt: nn.filter(n => n.type === 'dt').length, home: nn.filter(n => n.type === 'home').length })
    importedRef.current = true
  }, [])

  /* ---- Import backend data once ---- */
  useEffect(() => {
    if (importedRef.current || (poles.length === 0 && dts.length === 0)) return
    const r = containerRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    importedRef.current = true

    const W = r.width, H = r.height

    // --- 1. Create nodes (positions will be assigned later) ---
    const nn = []
    dts.forEach(dt => nn.push({ id: `bdt-${dt.dt_id}`, type: 'dt', x: 0, y: 0, label: dt.dt_id, status: 'live', meta: dt }))
    poles.forEach(p => nn.push({ id: `bp-${p.pole_id}`, type: 'pole', x: 0, y: 0, label: p.pole_id, status: p.status || 'live', meta: p, isFault: p.status === 'fault' }))

    const nMap = {}
    nn.forEach(n => { nMap[n.id] = n })

    // --- 2. Build edges by matching from/to lat/lon to nearest nodes ---
    // Use temporary GPS positions just for edge matching
    const all = [...poles.map(p => ({ lat: p.lat, lon: p.lon })), ...dts.map(d => ({ lat: d.lat, lon: d.lon }))]
    const lats = all.map(i => i.lat).filter(Boolean), lons = all.map(i => i.lon).filter(Boolean)
    const [mnLa, mxLa] = [Math.min(...lats), Math.max(...lats)]
    const [mnLo, mxLo] = [Math.min(...lons), Math.max(...lons)]
    const laR = mxLa - mnLa || 0.001, loR = mxLo - mnLo || 0.001
    const tX = lon => ((lon - mnLo) / loR) * 1000
    const tY = lat => ((mxLa - lat) / laR) * 1000

    // Assign temp GPS positions for edge matching
    dts.forEach(dt => { const n = nMap[`bdt-${dt.dt_id}`]; if (n) { n._gx = tX(dt.lon); n._gy = tY(dt.lat) } })
    poles.forEach(p => { const n = nMap[`bp-${p.pole_id}`]; if (n) { n._gx = tX(p.lon); n._gy = tY(p.lat) } })

    const ne = []
    initialEdges.forEach((e, i) => {
      const fx = tX(e.from_lon), fy = tY(e.from_lat), tx = tX(e.to_lon), ty = tY(e.to_lat)
      let fromN = null, toN = null, fd = Infinity, td = Infinity
      nn.forEach(n => {
        const gx = n._gx || 0, gy = n._gy || 0
        const d1 = (gx - fx) ** 2 + (gy - fy) ** 2, d2 = (gx - tx) ** 2 + (gy - ty) ** 2
        if (d1 < fd) { fd = d1; fromN = n }
        if (d2 < td) { td = d2; toN = n }
      })
      if (fromN && toN && fromN.id !== toN.id) {
        ne.push({ id: `be-${i}`, from: fromN.id, to: toN.id, type: autoEdgeType(fromN, toN), status: e.status || 'live' })
      }
    })

    // --- 3. Hierarchical tree layout ---
    // Build adjacency list
    const adj = {}
    nn.forEach(n => { adj[n.id] = [] })
    ne.forEach(e => {
      if (adj[e.from]) adj[e.from].push(e.to)
      if (adj[e.to]) adj[e.to].push(e.from)
    })

    // Group DTs by feeder (use meta.feeder_id if available)
    const feederGroups = {}
    nn.filter(n => n.type === 'dt').forEach(dt => {
      const fid = dt.meta?.feeder_id || 'default'
      if (!feederGroups[fid]) feederGroups[fid] = []
      feederGroups[fid].push(dt.id)
    })
    const feederIds = Object.keys(feederGroups)

    // Create a virtual substation
    const ssId = '__ss__'
    const ssNode = { id: ssId, type: 'substation', x: W / 2, y: 50, label: 'SS-01', status: 'live' }
    nn.push(ssNode)
    nMap[ssId] = ssNode
    adj[ssId] = []

    // Connect substation to all DTs with feeder edges
    feederIds.forEach(fid => {
      feederGroups[fid].forEach(dtId => {
        ne.push({ id: `be-ss-${dtId}`, from: ssId, to: dtId, type: 'feeder', status: 'live' })
        if (!adj[ssId]) adj[ssId] = []
        adj[ssId].push(dtId)
        if (adj[dtId]) adj[dtId].push(ssId)
      })
    })

    // BFS from substation to assign tree depth and children
    const visited = new Set()
    const parent = {}
    const childrenMap = {}
    const depthMap = {}
    const queue = [ssId]
    visited.add(ssId)
    depthMap[ssId] = 0
    childrenMap[ssId] = []

    while (queue.length) {
      const cur = queue.shift()
      for (const nb of (adj[cur] || [])) {
        if (!visited.has(nb)) {
          visited.add(nb)
          parent[nb] = cur
          depthMap[nb] = (depthMap[cur] || 0) + 1
          childrenMap[nb] = []
          if (!childrenMap[cur]) childrenMap[cur] = []
          childrenMap[cur].push(nb)
          queue.push(nb)
        }
      }
    }

    // Handle disconnected nodes — attach to nearest DT
    nn.forEach(n => {
      if (!visited.has(n.id) && n.id !== ssId) {
        visited.add(n.id)
        // Find nearest DT already in tree
        let nearDt = null, nearDist = Infinity
        nn.filter(nd => nd.type === 'dt' && depthMap[nd.id] !== undefined).forEach(dt => {
          const d = ((n._gx || 0) - (dt._gx || 0)) ** 2 + ((n._gy || 0) - (dt._gy || 0)) ** 2
          if (d < nearDist) { nearDist = d; nearDt = dt }
        })
        const attachTo = nearDt ? nearDt.id : ssId
        depthMap[n.id] = (depthMap[attachTo] || 0) + 1
        childrenMap[n.id] = []
        if (!childrenMap[attachTo]) childrenMap[attachTo] = []
        childrenMap[attachTo].push(n.id)
        parent[n.id] = attachTo
      }
    })

    // Compute subtree widths for spacing
    const subtreeWidth = {}
    const computeWidth = (id) => {
      const kids = childrenMap[id] || []
      if (kids.length === 0) { subtreeWidth[id] = 1; return 1 }
      let w = 0
      kids.forEach(k => { w += computeWidth(k) })
      subtreeWidth[id] = Math.max(w, 1)
      return subtreeWidth[id]
    }
    computeWidth(ssId)

    // Position nodes using recursive layout
    const LAYER_H = 70
    const LEAF_SPACING = 42
    const totalLeaves = subtreeWidth[ssId] || 1
    const totalWidth = Math.max(W - 80, totalLeaves * LEAF_SPACING)

    const positionTree = (id, leftX, availW, depth) => {
      const node = nMap[id]
      if (!node) return
      const kids = childrenMap[id] || []
      const myW = subtreeWidth[id] || 1

      // Center this node in its allocated width
      node.x = leftX + availW / 2
      node.y = 50 + depth * LAYER_H

      if (kids.length === 0) return

      // Distribute children proportionally
      let cursor = leftX
      kids.forEach(kid => {
        const kidW = subtreeWidth[kid] || 1
        const kidAlloc = (kidW / myW) * availW
        positionTree(kid, cursor, kidAlloc, depth + 1)
        cursor += kidAlloc
      })
    }

    const startX = (W - totalWidth) / 2
    positionTree(ssId, startX, totalWidth, 0)

    // Clean up temp GPS fields
    nn.forEach(n => { delete n._gx; delete n._gy })

    setNodes(nn); setEdges(ne)
    setCounters({ pole: nn.filter(n => n.type === 'pole').length, dt: nn.filter(n => n.type === 'dt').length, home: 0 })
    const fIds = new Set()
    ne.forEach(e => { if (e.status === 'fault') fIds.add(e.id) })
    nn.forEach(n => { if (n.isFault) fIds.add(n.id) })
    setFaultIds(fIds)
  }, [poles, dts, initialEdges])

  /* ---- Sync pole statuses from backend ---- */
  useEffect(() => {
    if (!poles.length) return
    const m = {}
    poles.forEach(p => { m[`bp-${p.pole_id}`] = { status: p.status || 'live', isFault: p.status === 'fault' } })
    setNodes(prev => prev.map(n => m[n.id] !== undefined ? { ...n, status: m[n.id].status, isFault: m[n.id].isFault } : n))
  }, [poles])

  /* ---- Animation loop ---- */
  useEffect(() => {
    let time = 0
    const render = () => {
      const c = canvasRef.current
      if (!c) { animRef.current = requestAnimationFrame(render); return }
      const ctx = c.getContext('2d')
      const dpr = window.devicePixelRatio || 1
      const w = c.width / dpr, h = c.height / dpr
      const s = S.current
      time++

      ctx.save(); ctx.scale(dpr, dpr)
      ctx.fillStyle = COLORS.bg; ctx.fillRect(0, 0, w, h)

      ctx.save()
      ctx.translate(s.transform.x, s.transform.y)
      ctx.scale(s.transform.scale, s.transform.scale)

      drawGrid(ctx, w, h, s.transform)

      const nm = {}
      s.nodes.forEach(n => { nm[n.id] = n })
      const flow = time * 0.5

      s.edges.forEach(e => {
        const isHighlight = s.highlightEdges && s.highlightEdges.has(e.id)
        drawEdgeLine(ctx, e, nm[e.from], nm[e.to], flow, time, s.selectedSet.has(e.id) || isHighlight)
      })

      // Wire preview
      if (s.wireStart && s.mode === 'addWire') {
        const sn = nm[s.wireStart]
        if (sn) {
          ctx.beginPath(); ctx.moveTo(sn.x, sn.y)
          ctx.lineTo(s.mouseWorld.x, s.mouseWorld.y)
          ctx.strokeStyle = COLORS.wirePreview; ctx.lineWidth = 2
          ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([])
        }
      }

      // Lasso rectangle
      drawLasso(ctx, s.lasso, s.transform)

      const bIds = new Set()
      s.boundaries.forEach(b => { bIds.add(b.live); bIds.add(b.dark) })
      s.nodes.forEach(n => {
        const isStudyHighlight = s.highlightNodes && s.highlightNodes.has(n.id)
        drawNode(ctx, n, s.selected?.id === n.id, s.selectedSet.has(n.id) || isStudyHighlight, bIds.has(n.id), time)
      })

      ctx.restore(); ctx.restore()
      animRef.current = requestAnimationFrame(render)
    }
    animRef.current = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animRef.current)
  }, [])

  /* ---- Mouse helpers ---- */
  const getWorld = useCallback((e) => {
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r) return { x: 0, y: 0 }
    return toWorld(e.clientX - r.left, e.clientY - r.top, S.current.transform)
  }, [])

  /* ---- Mouse DOWN ---- */
  const onDown = useCallback((e) => {
    if (e.button === 1 || e.button === 2) {
      const t = S.current.transform
      setPanStart({ mx: e.clientX, my: e.clientY, tx: t.x, ty: t.y, sc: t.scale })
      e.preventDefault(); return
    }
    const w = getWorld(e)
    const s = S.current
    const nm = {}; s.nodes.forEach(n => { nm[n.id] = n })
    const cn = hitNode(w.x, w.y, s.nodes)
    const ce = cn ? null : hitEdge(w.x, w.y, s.edges, nm)
    const isShift = e.shiftKey

    switch (s.mode) {
      case 'select':
        if (cn) {
          if (isShift) {
            // Toggle in multi-select
            setSelectedSet(prev => {
              const next = new Set(prev)
              if (next.has(cn.id)) next.delete(cn.id)
              else next.add(cn.id)
              return next
            })
          } else {
            setSelected(cn)
            setSelectedSet(new Set())
            setDragging({ id: cn.id, ox: w.x - cn.x, oy: w.y - cn.y })
          }
        } else if (ce) {
          if (isShift) {
            setSelectedSet(prev => {
              const next = new Set(prev)
              if (next.has(ce.id)) next.delete(ce.id)
              else next.add(ce.id)
              return next
            })
          } else {
            setSelected(ce)
            setSelectedSet(new Set())
          }
        } else {
          if (isShift) {
            // Start lasso
            setLasso({ x1: w.x, y1: w.y, x2: w.x, y2: w.y })
          } else {
            setSelected(null)
            setSelectedSet(new Set())
            const t = s.transform
            setPanStart({ mx: e.clientX, my: e.clientY, tx: t.x, ty: t.y, sc: t.scale })
          }
        }
        break
      case 'addPole':
        if (cn) { setDragging({ id: cn.id, ox: w.x - cn.x, oy: w.y - cn.y }) }
        else {
          const pn = s.counters.pole + 1
          setNodes(p => [...p, { id: `p-${Date.now()}`, type: 'pole', x: w.x, y: w.y, label: `P-${String(pn).padStart(3, '0')}`, status: 'live' }])
          setCounters(p => ({ ...p, pole: pn }))
        }
        break
      case 'addDT':
        if (!cn) {
          const dn = s.counters.dt + 1
          setNodes(p => [...p, { id: `dt-${Date.now()}`, type: 'dt', x: w.x, y: w.y, label: `DT-${String(dn).padStart(2, '0')}`, status: 'live' }])
          setCounters(p => ({ ...p, dt: dn }))
        }
        break
      case 'addHome':
        if (!cn) {
          const hn = s.counters.home + 1
          setNodes(p => [...p, { id: `h-${Date.now()}`, type: 'home', x: w.x, y: w.y, label: `H-${String(hn).padStart(2, '0')}`, status: 'live' }])
          setCounters(p => ({ ...p, home: hn }))
        }
        break
      case 'addWire':
        if (cn) setWireStart(cn.id)
        break
      case 'addFault':
        // Click an edge to toggle fault status
        if (ce) {
          if (ce.status === 'fault') {
            const repaired = s.edges.map(ed => ed.id === ce.id ? { ...ed, status: 'live' } : ed)
            const newNodes = rederiveStatuses(s.nodes, repaired)
            setEdges(repaired)
            setNodes(newNodes)
            setFaultIds(prev => { const next = new Set(prev); next.delete(ce.id); return next })
            if (onRepairSingle) onRepairSingle(ce.from);
          } else {
            const faulted = s.edges.map(ed => ed.id === ce.id ? { ...ed, status: 'fault' } : ed)
            const newNodes = rederiveStatuses(s.nodes, faulted)
            setEdges(faulted)
            setNodes(newNodes)
            setFaultIds(prev => new Set(prev).add(ce.id))
            const fromNode = s.nodes.find(n => n.id === ce.from);
            if (fromNode && onInjectFault) {
              onInjectFault('span', ce.from, fromNode.meta?.dt_id || null);
            }
          }
        } else if (cn && cn.type !== 'substation') {
          if (cn.isFault) {
            const repairedNodes = s.nodes.map(nd => nd.id === cn.id ? { ...nd, isFault: false } : nd)
            const newNodes = rederiveStatuses(repairedNodes, s.edges)
            setNodes(newNodes)
            setFaultIds(prev => { const next = new Set(prev); next.delete(cn.id); return next })
            if (onRepairSingle) onRepairSingle(cn.id);
          } else {
            const faultedNodes = s.nodes.map(nd => nd.id === cn.id ? { ...nd, isFault: true } : nd)
            const newNodes = rederiveStatuses(faultedNodes, s.edges)
            setNodes(newNodes)
            setFaultIds(prev => new Set(prev).add(cn.id))
            if (cn.type === 'dt' && onInjectFault) {
               onInjectFault('dt', cn.id, null);
            }
          }
        }
        break
      case 'delete':
        if (cn) {
          setNodes(p => p.filter(n => n.id !== cn.id))
          setEdges(p => p.filter(e => e.from !== cn.id && e.to !== cn.id))
          if (s.selected?.id === cn.id) setSelected(null)
          setSelectedSet(prev => { const next = new Set(prev); next.delete(cn.id); return next })
        } else if (ce) {
          setEdges(p => p.filter(e => e.id !== ce.id))
          if (s.selected?.id === ce.id) setSelected(null)
          setSelectedSet(prev => { const next = new Set(prev); next.delete(ce.id); return next })
          setFaultIds(prev => { const next = new Set(prev); next.delete(ce.id); return next })
        }
        break
    }
  }, [getWorld, onInjectFault, onRepairSingle])

  /* ---- Mouse MOVE ---- */
  const onMove = useCallback((e) => {
    const s = S.current
    if (s.panStart) {
      setTransform({ x: s.panStart.tx + (e.clientX - s.panStart.mx), y: s.panStart.ty + (e.clientY - s.panStart.my), scale: s.panStart.sc })
      return
    }
    if (s.lasso) {
      const w = getWorld(e)
      setLasso(prev => prev ? { ...prev, x2: w.x, y2: w.y } : null)
      return
    }
    if (s.dragging) {
      const w = getWorld(e)
      setNodes(prev => prev.map(n => n.id === s.dragging.id ? { ...n, x: w.x - s.dragging.ox, y: w.y - s.dragging.oy } : n))
      return
    }
    if (s.wireStart) setMouseWorld(getWorld(e))
  }, [getWorld])

  /* ---- Mouse UP ---- */
  const onUp = useCallback((e) => {
    const s = S.current

    // Finish lasso selection
    if (s.lasso) {
      const { x1, y1, x2, y2 } = s.lasso
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1)
      if (w > 5 || h > 5) {
        const hits = nodesInRect(s.nodes, x1, y1, x2, y2)
        // Also select edges whose both endpoints are in the rect
        const hitNodeIds = new Set(hits.map(n => n.id))
        const hitEdgeIds = s.edges
          .filter(ed => hitNodeIds.has(ed.from) && hitNodeIds.has(ed.to))
          .map(ed => ed.id)
        setSelectedSet(prev => {
          const next = new Set(prev)
          hits.forEach(n => next.add(n.id))
          hitEdgeIds.forEach(id => next.add(id))
          return next
        })
      }
      setLasso(null)
      return
    }

    if (s.wireStart) {
      const w = getWorld(e)
      const target = hitNode(w.x, w.y, s.nodes)
      if (target && target.id !== s.wireStart) {
        const nm = {}; s.nodes.forEach(n => { nm[n.id] = n })
        const from = nm[s.wireStart]
        const dup = s.edges.some(e => (e.from === s.wireStart && e.to === target.id) || (e.from === target.id && e.to === s.wireStart))
        if (!dup && from) {
          setEdges(p => [...p, { id: `e-${Date.now()}`, from: s.wireStart, to: target.id, type: autoEdgeType(from, target), status: 'live' }])
        }
      }
      setWireStart(null)
    }
    setDragging(null); setPanStart(null)
  }, [getWorld])

  /* ---- Wheel zoom ---- */
  const onWheel = useCallback((e) => {
    e.preventDefault()
    const r = canvasRef.current?.getBoundingClientRect()
    if (!r) return
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const s = S.current.transform
    const factor = e.deltaY > 0 ? 0.92 : 1.08
    const ns = Math.max(0.15, Math.min(5, s.scale * factor))
    const ratio = ns / s.scale
    setTransform({ scale: ns, x: mx - (mx - s.x) * ratio, y: my - (my - s.y) * ratio })
  }, [])

  /* ---- Action handlers ---- */
  const handleRandom = () => {
    // Generate purely local fake random layout (will be overwritten by backend next tick)
    const r = containerRef.current?.getBoundingClientRect()
    const { nodes: nn, edges: ne } = genNetwork(r?.width || 1200, r?.height || 700)
    setNodes(nn); setEdges(ne); setBoundaries([]); setFaultIds(new Set()); setSelected(null); setSelectedSet(new Set())
    setTransform({ x: 0, y: 0, scale: 1 })
    setCounters({ pole: nn.filter(n => n.type === 'pole').length, dt: nn.filter(n => n.type === 'dt').length, home: nn.filter(n => n.type === 'home').length })
  }

  const handleSolve = () => {
    setBoundaries(solveFault(nodes, edges))
    if (showStudy) handleStepSolve()
  }

  /* ---- Step-by-step solve for Study mode ---- */
  const handleStepSolve = () => {
    const steps = []
    const children = {}
    nodes.forEach(n => { children[n.id] = [] })
    edges.forEach(e => { if (children[e.from]) children[e.from].push({ nid: e.to, eid: e.id }) })

    const ss = nodes.find(n => n.type === 'substation')
    if (!ss) return

    steps.push({
      title: 'Step 1: Find Root (Substation)',
      desc: `Start BFS/DFS from the power source: ${ss.label}. The substation is always energized.`,
      algo: 'Tree Root Identification',
      complexity: 'O(1)',
      nodes: new Set([ss.id]),
      edges: new Set(),
    })

    // BFS to find live nodes
    const adj = {}
    nodes.forEach(n => { adj[n.id] = [] })
    edges.forEach(e => {
      if (e.status !== 'fault') {
        if (adj[e.from]) adj[e.from].push({ nid: e.to, eid: e.id })
        if (adj[e.to]) adj[e.to].push({ nid: e.from, eid: e.id })
      }
    })

    const visited = new Set([ss.id])
    const bfsQueue = [ss.id]
    const visitedEdges = new Set()
    const bfsOrder = [ss.id]

    while (bfsQueue.length) {
      const cur = bfsQueue.shift()
      const curNode = nodes.find(n => n.id === cur)
      if (curNode && curNode.isFault) continue
      for (const nb of (adj[cur] || [])) {
        const nbNode = nodes.find(n => n.id === nb.nid)
        if (nbNode && !nbNode.isFault && !visited.has(nb.nid)) {
          visited.add(nb.nid)
          visitedEdges.add(nb.eid)
          bfsQueue.push(nb.nid)
          bfsOrder.push(nb.nid)
        }
      }
    }

    steps.push({
      title: 'Step 2: BFS — Traverse Live Network',
      desc: `Starting from ${ss.label}, BFS explores all reachable nodes through non-faulted edges. Found ${visited.size} energized nodes.`,
      algo: 'Breadth-First Search (BFS)',
      complexity: 'O(V + E)',
      nodes: new Set(visited),
      edges: new Set(visitedEdges),
    })

    // Find dark nodes
    const darkNodes = new Set()
    nodes.forEach(n => {
      if (!visited.has(n.id) && n.type !== 'substation') darkNodes.add(n.id)
    })

    steps.push({
      title: 'Step 3: Identify Dark (De-energized) Nodes',
      desc: `Nodes NOT reached by BFS are dark/de-energized. Found ${darkNodes.size} dark nodes. These poles have lost power.`,
      algo: 'Set Difference: All Nodes − BFS Visited',
      complexity: 'O(V)',
      nodes: darkNodes,
      edges: new Set(),
    })

    // Find boundaries
    const bounds = []
    const boundaryNodes = new Set()
    const boundaryEdges = new Set()
    const dfs = (id) => {
      const node = nodes.find(n => n.id === id)
      if (!node) return
      for (const ch of (children[id] || [])) {
        const cn = nodes.find(n => n.id === ch.nid)
        if (!cn) continue
        if (node.status === 'live' && cn.status !== 'live') {
          bounds.push({ live: id, dark: ch.nid, edge: ch.eid, isNodeFault: !!cn.isFault })
          boundaryNodes.add(id)
          boundaryNodes.add(ch.nid)
          boundaryEdges.add(ch.eid)
        } else {
          dfs(ch.nid)
        }
      }
    }
    dfs(ss.id)

    steps.push({
      title: 'Step 4: DFS — Find Live→Dark Boundaries',
      desc: `Walk the tree (DFS) from root. When a LIVE node has a DARK child, that edge is the fault boundary. Found ${bounds.length} boundary point(s).`,
      algo: 'Depth-First Search (DFS) + Boundary Detection',
      complexity: 'O(V + E)',
      nodes: boundaryNodes,
      edges: boundaryEdges,
    })

    steps.push({
      title: 'Step 5: Fault Localized!',
      desc: bounds.map(b => {
        const liveN = nodes.find(n => n.id === b.live)
        const darkN = nodes.find(n => n.id === b.dark)
        return `Fault between ${liveN?.label || '?'} (live) → ${darkN?.label || '?'} (dark)${b.isNodeFault ? ' [Pole Failure]' : ' [Wire Break]'}`
      }).join('\n'),
      algo: 'Result: Fault Location(s)',
      complexity: 'Total: O(V + E)',
      nodes: boundaryNodes,
      edges: boundaryEdges,
    })

    setSolveSteps(steps)
    setCurrentStep(0)
    setHighlightNodes(steps[0].nodes)
    setHighlightEdges(steps[0].edges)
  }

  const handleStepNav = (dir) => {
    const next = Math.max(0, Math.min(solveSteps.length - 1, currentStep + dir))
    setCurrentStep(next)
    setHighlightNodes(solveSteps[next].nodes)
    setHighlightEdges(solveSteps[next].edges)
  }

  const handleCloseStudy = () => {
    setShowStudy(false)
    setSolveSteps([])
    setCurrentStep(-1)
    setHighlightNodes(new Set())
    setHighlightEdges(new Set())
  }

  const handleRepairAll = () => {
    setNodes(p => p.map(n => ({ ...n, status: 'live', isFault: false })))
    setEdges(p => p.map(e => ({ ...e, status: 'live' })))
    setBoundaries([]); setFaultIds(new Set()); setSelectedSet(new Set())
    if (onRepairAll) onRepairAll();
  }

  const handleRepairSingleLocal = (id) => {
    const repairedEdges = edges.map(e => e.id === id ? { ...e, status: 'live' } : e)
    const repairedNodes = nodes.map(n => (n.id === id && n.isFault) ? { ...n, isFault: false } : n)
    const newNodes = rederiveStatuses(repairedNodes, repairedEdges)
    const remaining = new Set()
    repairedEdges.forEach(e => { if (e.status === 'fault') remaining.add(e.id) })
    newNodes.forEach(n => { if (n.isFault) remaining.add(n.id) })
    setEdges(repairedEdges)
    setNodes(newNodes)
    setFaultIds(remaining)
    setBoundaries([])
    if (selected?.id === id) setSelected(null)
    setSelectedSet(prev => { const next = new Set(prev); next.delete(id); return next })
    
    // Call backend
    const edge = edges.find(e => e.id === id);
    if (edge) {
      if (onRepairSingle) onRepairSingle(edge.from);
    } else {
      if (onRepairSingle) onRepairSingle(id);
    }
  }

  const handleRepairSelected = () => {
    const sel = S.current.selectedSet
    // Visual update
    const repairedEdges = edges.map(e => (sel.has(e.id) && e.status === 'fault') ? { ...e, status: 'live' } : e)
    const repairedNodes = nodes.map(n => (sel.has(n.id) && n.isFault) ? { ...n, isFault: false } : n)
    const newNodes = rederiveStatuses(repairedNodes, repairedEdges)
    const remaining = new Set()
    repairedEdges.forEach(e => { if (e.status === 'fault') remaining.add(e.id) })
    newNodes.forEach(n => { if (n.isFault) remaining.add(n.id) })
    setEdges(repairedEdges)
    setNodes(newNodes)
    setFaultIds(remaining)
    setBoundaries([])
    setSelectedSet(new Set())

    if (onRepairSingle) {
      sel.forEach(id => {
        const edge = edges.find(e => e.id === id);
        if (edge) onRepairSingle(edge.from);
        else onRepairSingle(id);
      })
    }
  }

  const handleClear = () => {
    setNodes([]); setEdges([]); setBoundaries([])
    setFaultIds(new Set()); setSelected(null); setSelectedSet(new Set())
    setCounters({ pole: 0, dt: 0, home: 0 })
    importedRef.current = false
  }

  const cursor = MODES.find(m => m.id === mode)?.cursor || 'default'
  const poleCount = nodes.filter(n => n.type === 'pole').length
  const dtCount = nodes.filter(n => n.type === 'dt').length
  const homeCount = nodes.filter(n => n.type === 'home').length
  const faultCount = faultIds.size
  const hasAnyFault = faultCount > 0
  const selectedFaultCount = [...selectedSet].filter(id => faultIds.has(id)).length

  /* ---- RENDER ---- */
  return (
    <div className="canvas-container" ref={containerRef}>
      {/* Toolbar */}
      <div className="canvas-toolbar">
        <div className="canvas-modes">
          {MODES.map(m => (
            <button
              key={m.id}
              className={`canvas-mode-btn ${mode === m.id ? 'active' : ''} ${m.id === 'addFault' ? 'fault-mode' : ''}`}
              onClick={() => setMode(m.id)}
              title={m.id === 'addFault' ? 'Click edges to add/remove faults' : m.label}
            >
              <span className="mode-icon">{m.icon}</span>
              <span className="mode-label">{m.label}</span>
            </button>
          ))}
        </div>
        <div className="canvas-toolbar-sep" />
        <div className="canvas-actions">
          <button className="canvas-act-btn random" onClick={handleRandom}>🎲 Random</button>
          <button className="canvas-act-btn solve" onClick={handleSolve} disabled={!hasAnyFault}>🔍 Solve</button>
          {selectedFaultCount > 0 && (
            <button className="canvas-act-btn repair-sel" onClick={handleRepairSelected}>
              🔧 Repair ({selectedFaultCount})
            </button>
          )}
          <button className="canvas-act-btn repair" onClick={handleRepairAll} disabled={!hasAnyFault}>
            🔧 {selectedFaultCount > 0 ? 'Repair All' : 'Repair'}
          </button>
          <button className="canvas-act-btn clear" onClick={handleClear}>🗑️ Clear</button>
          <div className="canvas-toolbar-sep" />
          <button className={`canvas-act-btn study ${showStudy ? 'active' : ''}`} onClick={() => showStudy ? handleCloseStudy() : setShowStudy(true)}>📚 Study</button>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        style={{ cursor, display: 'block' }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onWheel={onWheel}
        onContextMenu={e => e.preventDefault()}
      />

      {/* Legend */}
      <div className="canvas-legend">
        <div className="legend-title">Legend</div>
        <div className="legend-row"><span className="legend-shape diamond" style={{ background: '#7c3aed' }} /> Substation</div>
        <div className="legend-row"><span className="legend-shape square" style={{ background: '#3b82f6' }} /> Transformer</div>
        <div className="legend-row"><span className="legend-shape circle" style={{ background: '#22c55e' }} /> Pole (Live)</div>
        <div className="legend-row"><span className="legend-shape circle" style={{ background: '#ef4444' }} /> Pole (Dark)</div>
        <div className="legend-row"><span className="legend-shape circle" style={{ background: '#6b7280' }} /> Pole (Unknown)</div>
        <div className="legend-row"><span className="legend-shape house" style={{ background: '#f97316' }} /> Home</div>
        <div className="legend-sep" />
        <div className="legend-row"><span className="legend-line" style={{ background: '#a78bfa' }} /> Feeder</div>
        <div className="legend-row"><span className="legend-line" style={{ background: '#60a5fa' }} /> LT Line</div>
        <div className="legend-row"><span className="legend-line" style={{ background: '#4ade80' }} /> Span</div>
        <div className="legend-row"><span className="legend-line dashed" style={{ background: '#fb923c' }} /> Service Drop</div>
        <div className="legend-row"><span className="legend-line" style={{ background: '#ef4444' }} /> ⚡ Fault</div>
        <div className="legend-sep" />
        <div className="legend-hint">Shift+click: multi-select</div>
        <div className="legend-hint">Shift+drag: lasso select</div>
      </div>

      {/* Selected node/edge info */}
      {selected && selected.type && (
        <div className="canvas-info-panel">
          <div className="info-close" onClick={() => setSelected(null)}>✕</div>
          <div className="info-title">{selected.label}</div>
          <div className="info-row"><span>Type</span><span className="info-val">{selected.type}</span></div>
          <div className="info-row"><span>Status</span><span className="info-val" style={{ color: COLORS.pole[selected.status] || '#9ca3af' }}>{selected.status}</span></div>
          {selected.meta?.dt_id && <div className="info-row"><span>DT</span><span className="info-val">{selected.meta.dt_id}</span></div>}
          {selected.meta?.feeder_id && <div className="info-row"><span>Feeder</span><span className="info-val">{selected.meta.feeder_id}</span></div>}
          {selected.meta?.pincode && <div className="info-row"><span>PIN</span><span className="info-val">{selected.meta.pincode}</span></div>}
          {selected.isFault && (
            <button className="canvas-act-btn repair single-repair-btn" onClick={() => handleRepairSingleLocal(selected.id)}>
              🔧 Repair This Fault
            </button>
          )}
          <div className="info-hint">Drag to move · Right-click to pan</div>
        </div>
      )}

      {/* Selected edge info (when a faulted edge is selected) */}
      {selected && !selected.type && selected.status === 'fault' && (
        <div className="canvas-info-panel">
          <div className="info-close" onClick={() => setSelected(null)}>✕</div>
          <div className="info-title">⚡ Fault</div>
          <div className="info-row"><span>Edge</span><span className="info-val">{selected.id}</span></div>
          <div className="info-row"><span>Type</span><span className="info-val">{selected.type || 'span'}</span></div>
          <div className="info-row">
            <span>From</span>
            <span className="info-val">{nodes.find(n => n.id === selected.from)?.label || selected.from}</span>
          </div>
          <div className="info-row">
            <span>To</span>
            <span className="info-val">{nodes.find(n => n.id === selected.to)?.label || selected.to}</span>
          </div>
          <button className="canvas-act-btn repair single-repair-btn" onClick={() => handleRepairSingle(selected.id)}>
            🔧 Repair This Fault
          </button>
          <div className="info-hint">Or Shift+click to multi-select faults</div>
        </div>
      )}

      {/* Solve results */}
      {boundaries.length > 0 && (
        <div className="canvas-solve-panel">
          <div className="solve-title">🔍 Fault Localized ({faultCount} fault{faultCount !== 1 ? 's' : ''})</div>
          {boundaries.map((b, i) => (
            <div key={i} className="solve-row">
              <span className="solve-live">● {nodes.find(n => n.id === b.live)?.label}</span>
              <span className="solve-arrow">→</span>
              <span className="solve-dark">
                ● {nodes.find(n => n.id === b.dark)?.label}
                {b.isNodeFault ? ' (Pole Failure)' : ' (Wire Span Break)'}
              </span>
            </div>
          ))}
          <div className="solve-hint">Identifies transition between energized and faulted equipment</div>
        </div>
      )}

      {/* Multi-select info bar */}
      {selectedSet.size > 0 && (
        <div className="canvas-multisel-bar">
          <span className="multisel-count">{selectedSet.size} selected</span>
          {selectedFaultCount > 0 && (
            <button className="canvas-act-btn repair-sel compact" onClick={handleRepairSelected}>
              🔧 Repair {selectedFaultCount} fault{selectedFaultCount !== 1 ? 's' : ''}
            </button>
          )}
          <button className="multisel-clear" onClick={() => setSelectedSet(new Set())}>✕ Clear</button>
        </div>
      )}

      {/* Stats bar */}
      <div className="canvas-stats">
        {poleCount} poles · {dtCount} DTs · {homeCount} homes · {edges.length} edges
        {faultCount > 0 && <span className="stats-faults"> · ⚡ {faultCount} fault{faultCount !== 1 ? 's' : ''}</span>}
      </div>

      {/* ========== STUDY PANEL ========== */}
      {showStudy && (
        <div className="study-panel">
          <div className="study-header">
            <h2 className="study-title">📚 Algorithm Study Center</h2>
            <button className="study-close" onClick={handleCloseStudy}>✕</button>
          </div>

          <div className="study-tabs">
            {[
              { id: 'overview', label: '🎯 Overview' },
              { id: 'algorithms', label: '🧮 Algorithms' },
              { id: 'dsa', label: '📊 DSA Concepts' },
              { id: 'walkthrough', label: '🚶 Walkthrough' },
              { id: 'realworld', label: '🏢 Real World' },
              { id: 'implementation', label: '🚀 Deploy' },
            ].map(t => (
              <button
                key={t.id}
                className={`study-tab ${studyTab === t.id ? 'active' : ''}`}
                onClick={() => setStudyTab(t.id)}
              >{t.label}</button>
            ))}
          </div>

          <div className="study-body">
            {/* --- OVERVIEW TAB --- */}
            {studyTab === 'overview' && (
              <div className="study-section">
                <h3>What This Project Solves</h3>
                <div className="study-card">
                  <div className="study-card-icon">⚡</div>
                  <div>
                    <strong>Power Grid Fault Localization</strong>
                    <p>When a wire breaks or a pole/transformer fails in an electrical distribution network, thousands of homes lose power. This system <em>automatically detects and pinpoints</em> the exact location of faults using IoT sensor data.</p>
                  </div>
                </div>

                <h3>The Problem</h3>
                <div className="study-card problem">
                  <p>Power flows as a <strong>radial tree</strong>: Substation → Feeders → Transformers → Poles → Homes.</p>
                  <p>When a line segment fails, everything <strong>downstream goes dark</strong>. With thousands of poles, manually finding the break point is slow and expensive.</p>
                  <p>IoT sensors on ~91% of poles report one bit: <code>energized</code> or <code>not</code>. The challenge: <em>use this binary data to find the exact fault location</em>.</p>
                </div>

                <h3>The Solution</h3>
                <div className="study-card solution">
                  <p>Model the network as a <strong>tree graph</strong>, then use <strong>BFS/DFS traversal</strong> to find the boundary between live and dark nodes. The fault is at that boundary.</p>
                  <p>This runs in <code>O(V + E)</code> time — fast enough for real-time detection on networks with thousands of nodes.</p>
                </div>

                <h3>How To Use This Visualizer</h3>
                <ol className="study-steps">
                  <li><strong>🎲 Random</strong> — Generate a new random power network</li>
                  <li><strong>⚡ Fault Mode</strong> — Click edges/nodes to inject faults</li>
                  <li><strong>🔍 Solve</strong> — Run the fault localization algorithm</li>
                  <li><strong>🔧 Repair</strong> — Fix faults and restore power</li>
                  <li><strong>📚 Study → Walkthrough</strong> — Step through the algorithm visually</li>
                </ol>
              </div>
            )}

            {/* --- ALGORITHMS TAB --- */}
            {studyTab === 'algorithms' && (
              <div className="study-section">
                <h3>Core Algorithm: Fault Boundary Detection</h3>

                <div className="study-algo-block">
                  <div className="algo-header">
                    <span className="algo-badge bfs">BFS</span>
                    <strong>Step 1: Power Flow Simulation</strong>
                  </div>
                  <p>Starting from the substation (root), BFS traverses all edges that are NOT faulted. Every node reached is "live" (energized). Nodes not reached are "dark".</p>
                  <pre className="study-code">{`function powerFlowBFS(root, edges) {
  const visited = new Set([root.id])
  const queue = [root.id]

  while (queue.length > 0) {
    const current = queue.shift()
    for (const neighbor of adjacency[current]) {
      if (!visited.has(neighbor)
          && edge(current, neighbor).status !== 'fault') {
        visited.add(neighbor)
        queue.push(neighbor)  // ← FIFO = BFS
      }
    }
  }
  // visited = all energized nodes
  // not visited = dark (no power)
}`}</pre>
                  <div className="algo-complexity">
                    <span>Time: <code>O(V + E)</code></span>
                    <span>Space: <code>O(V)</code></span>
                  </div>
                </div>

                <div className="study-algo-block">
                  <div className="algo-header">
                    <span className="algo-badge dfs">DFS</span>
                    <strong>Step 2: Boundary Detection</strong>
                  </div>
                  <p>Walk the tree from root using DFS. When we find a <span className="text-live">LIVE</span> node whose child is <span className="text-dark">DARK</span>, that edge is the fault boundary. The fault is on or near that edge.</p>
                  <pre className="study-code">{`function findBoundaries(root) {
  const boundaries = []

  function dfs(nodeId) {
    const node = graph[nodeId]
    for (const child of node.children) {
      if (node.status === 'live'
          && child.status !== 'live') {
        boundaries.push({
          live: nodeId,      // last energized
          dark: child.id,    // first de-energized
          edge: getEdge(nodeId, child.id)
        })
      } else {
        dfs(child.id)  // ← recurse deeper
      }
    }
  }
  dfs(root.id)
  return boundaries
}`}</pre>
                  <div className="algo-complexity">
                    <span>Time: <code>O(V + E)</code></span>
                    <span>Space: <code>O(H)</code> <small>(H = tree height)</small></span>
                  </div>
                </div>

                <div className="study-algo-block">
                  <div className="algo-header">
                    <span className="algo-badge tree">TREE</span>
                    <strong>Why Trees Make This Efficient</strong>
                  </div>
                  <p>Power distribution networks are <strong>radial trees</strong> (no cycles). This is crucial because:</p>
                  <ul>
                    <li>A single fault creates exactly one disconnected subtree</li>
                    <li>There's only ONE path from root to any node</li>
                    <li>The boundary point uniquely identifies the fault location</li>
                    <li>Multiple simultaneous faults create multiple disconnected subtrees</li>
                  </ul>
                </div>
              </div>
            )}

            {/* --- DSA CONCEPTS TAB --- */}
            {studyTab === 'dsa' && (
              <div className="study-section">
                <h3>Data Structures & Algorithms Used</h3>

                <div className="dsa-grid">
                  <div className="dsa-card">
                    <div className="dsa-icon">🌳</div>
                    <h4>Tree (Rooted)</h4>
                    <p>The power network is modeled as a rooted tree. The substation is the root; transformers and poles are children. No cycles exist.</p>
                    <div className="dsa-tag">Data Structure</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">📊</div>
                    <h4>Graph (Adjacency List)</h4>
                    <p>Nodes (poles, DTs) and edges (wires) form a graph stored as an adjacency list for O(1) neighbor lookups.</p>
                    <div className="dsa-tag">Data Structure</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">🔄</div>
                    <h4>BFS (Breadth-First Search)</h4>
                    <p>Used to simulate power flow. BFS from root finds all reachable (energized) nodes. Uses a queue (FIFO).</p>
                    <div className="dsa-tag">Algorithm — O(V+E)</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">🔽</div>
                    <h4>DFS (Depth-First Search)</h4>
                    <p>Used to walk the tree and find live→dark boundaries. Recursively explores each branch until a status change is found.</p>
                    <div className="dsa-tag">Algorithm — O(V+E)</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">🗂️</div>
                    <h4>Hash Set</h4>
                    <p>Used for O(1) visited-node lookups during BFS/DFS, and for tracking which nodes are live vs dark.</p>
                    <div className="dsa-tag">Data Structure — O(1) lookup</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">📦</div>
                    <h4>Queue (FIFO)</h4>
                    <p>BFS uses a queue to explore nodes level-by-level, ensuring we visit all nodes at depth d before d+1.</p>
                    <div className="dsa-tag">Data Structure</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">🔀</div>
                    <h4>Set Difference</h4>
                    <p>Dark nodes = All nodes − BFS visited set. A simple but powerful operation to identify de-energized equipment.</p>
                    <div className="dsa-tag">Operation — O(V)</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">🎯</div>
                    <h4>Greedy Tree Construction</h4>
                    <p>For DTs without surveyed pole ordering, GPS-based greedy nearest-neighbor builds the topology tree.</p>
                    <div className="dsa-tag">Algorithm</div>
                  </div>
                </div>

                <h3>Complexity Analysis</h3>
                <table className="study-table">
                  <thead>
                    <tr><th>Operation</th><th>Time</th><th>Space</th><th>Why</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Power Flow (BFS)</td><td>O(V + E)</td><td>O(V)</td><td>Visit every node and edge once</td></tr>
                    <tr><td>Boundary Detection (DFS)</td><td>O(V + E)</td><td>O(H)</td><td>Walk tree, stop at boundaries</td></tr>
                    <tr><td>Topology Build (Greedy)</td><td>O(N² log N)</td><td>O(N)</td><td>Nearest neighbor for each pole</td></tr>
                    <tr><td>Full Localization</td><td>O(V + E)</td><td>O(V)</td><td>BFS + DFS combined</td></tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* --- WALKTHROUGH TAB --- */}
            {studyTab === 'walkthrough' && (
              <div className="study-section">
                <h3>Step-by-Step Algorithm Walkthrough</h3>

                {!hasAnyFault && (
                  <div className="study-card warning">
                    <strong>⚠️ No faults in the network!</strong>
                    <p>To see the algorithm in action:</p>
                    <ol>
                      <li>Select <strong>⚡ Fault</strong> mode from the toolbar</li>
                      <li>Click on an edge (green wire) to inject a fault</li>
                      <li>Click <strong>🔍 Solve</strong> to run the algorithm</li>
                      <li>Come back here to see the step-by-step walkthrough</li>
                    </ol>
                  </div>
                )}

                {hasAnyFault && solveSteps.length === 0 && (
                  <div className="study-card">
                    <strong>Click 🔍 Solve to generate the walkthrough</strong>
                    <p>The Solve button will run the algorithm and populate the steps here.</p>
                    <button className="canvas-act-btn solve" onClick={handleSolve} style={{ marginTop: 8 }}>🔍 Solve & Generate Steps</button>
                  </div>
                )}

                {solveSteps.length > 0 && (
                  <div className="walkthrough-container">
                    <div className="step-nav">
                      <button className="step-btn" onClick={() => handleStepNav(-1)} disabled={currentStep <= 0}>◀ Prev</button>
                      <span className="step-counter">Step {currentStep + 1} of {solveSteps.length}</span>
                      <button className="step-btn" onClick={() => handleStepNav(1)} disabled={currentStep >= solveSteps.length - 1}>Next ▶</button>
                    </div>

                    <div className="step-progress">
                      {solveSteps.map((_, i) => (
                        <div
                          key={i}
                          className={`step-dot ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'done' : ''}`}
                          onClick={() => { setCurrentStep(i); setHighlightNodes(solveSteps[i].nodes); setHighlightEdges(solveSteps[i].edges) }}
                        />
                      ))}
                    </div>

                    <div className="step-content">
                      <h4>{solveSteps[currentStep].title}</h4>
                      <div className="step-algo-badge">
                        <span className="algo-badge step">{solveSteps[currentStep].algo}</span>
                        <code>{solveSteps[currentStep].complexity}</code>
                      </div>
                      <p className="step-desc">{solveSteps[currentStep].desc}</p>
                      <div className="step-highlight-info">
                        🔵 Highlighted nodes on canvas: {solveSteps[currentStep].nodes.size}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* --- REAL WORLD TAB --- */}
            {studyTab === 'realworld' && (
              <div className="study-section">
                <h3>Who Uses This System?</h3>

                <div className="stakeholder-grid">
                  <div className="dsa-card">
                    <div className="dsa-icon">🏛️</div>
                    <h4>DISCOMs / Electricity Boards</h4>
                    <p>State electricity distribution companies (e.g., BSES, Tata Power, MSEDCL) that own and operate the last-mile distribution network.</p>
                    <div className="dsa-tag">PRIMARY USER</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">👷</div>
                    <h4>Field Crew / Linemen</h4>
                    <p>Receive precise fault location tickets on mobile. Go directly to the fault span instead of walking the entire line.</p>
                    <div className="dsa-tag">FIELD OPERATOR</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">📊</div>
                    <h4>Control Room Operators</h4>
                    <p>Monitor real-time network health on the operator console. Acknowledge faults, dispatch crews, and track resolution.</p>
                    <div className="dsa-tag">MONITOR</div>
                  </div>

                  <div className="dsa-card">
                    <div className="dsa-icon">⚖️</div>
                    <h4>Regulators (CERC/SERC)</h4>
                    <p>Use outage data and MTTR (Mean Time To Repair) metrics for quality-of-service benchmarks and tariff reviews.</p>
                    <div className="dsa-tag">REGULATORY</div>
                  </div>
                </div>

                <h3>How a DISCOM Would Use This</h3>

                <div className="workflow-timeline">
                  <div className="workflow-step">
                    <div className="workflow-num">1</div>
                    <div className="workflow-content">
                      <strong>Install IoT Sensors</strong>
                      <p>Mount low-cost sensor units on each distribution pole. Each reports 1 bit: <code>energized</code> or <code>not</code>. Uses cellular (4G/NB-IoT) or LoRa to transmit heartbeats every 30s.</p>
                    </div>
                  </div>
                  <div className="workflow-step">
                    <div className="workflow-num">2</div>
                    <div className="workflow-content">
                      <strong>Map Network Topology</strong>
                      <p>Survey pole GPS coordinates and transformer connections. For DTs without surveyed pole ordering, the system auto-infers topology using GPS-based greedy tree construction.</p>
                    </div>
                  </div>
                  <div className="workflow-step">
                    <div className="workflow-num">3</div>
                    <div className="workflow-content">
                      <strong>Ingest Telemetry</strong>
                      <p>Sensors send <code>heartbeat</code>, <code>power_lost</code>, and <code>power_restored</code> events. The system processes ~3,800 devices with 10-second sweep cycles.</p>
                    </div>
                  </div>
                  <div className="workflow-step">
                    <div className="workflow-num">4</div>
                    <div className="workflow-content">
                      <strong>Auto-Detect & Localize Faults</strong>
                      <p>When multiple sensors go dark, the fault engine runs BFS/DFS to find the exact span. Corroboration logic prevents false positives (requires 3+ dark poles within 30s).</p>
                    </div>
                  </div>
                  <div className="workflow-step">
                    <div className="workflow-num">5</div>
                    <div className="workflow-content">
                      <strong>Create Ticket & Dispatch Crew</strong>
                      <p>Auto-generates a fault ticket with: fault span, affected DT, confidence level (HIGH/MEDIUM/LOW), and number of affected poles. Pushes to control room via real-time SSE.</p>
                    </div>
                  </div>
                  <div className="workflow-step">
                    <div className="workflow-num">6</div>
                    <div className="workflow-content">
                      <strong>Track Resolution</strong>
                      <p>Ticket lifecycle: <code>detected → acknowledged → crew_assigned → resolved → verified → closed</code>. Auto-verifies when affected poles report power restored.</p>
                    </div>
                  </div>
                </div>

                <h3>Key Benefits for Utilities</h3>

                <div className="benefits-grid">
                  <div className="benefit-card">
                    <div className="benefit-icon">⏱️</div>
                    <div className="benefit-text">
                      <strong>80% Faster Fault Response</strong>
                      <p>Crews go directly to the fault location instead of patrolling the entire line. Reduces MTTR from hours to minutes.</p>
                    </div>
                  </div>
                  <div className="benefit-card">
                    <div className="benefit-icon">💰</div>
                    <div className="benefit-text">
                      <strong>Reduced Revenue Loss</strong>
                      <p>Every hour of outage = lost billing revenue. Faster restoration means less AT&C (Aggregate Technical & Commercial) loss.</p>
                    </div>
                  </div>
                  <div className="benefit-card">
                    <div className="benefit-icon">📉</div>
                    <div className="benefit-text">
                      <strong>Lower SAIDI/SAIFI Indices</strong>
                      <p>System Average Interruption Duration/Frequency Index — key regulatory metrics that directly impact tariff approvals.</p>
                    </div>
                  </div>
                  <div className="benefit-card">
                    <div className="benefit-icon">🛡️</div>
                    <div className="benefit-text">
                      <strong>Predictive Maintenance</strong>
                      <p>Historical fault data reveals weak spots. Utilities can proactively replace aging infrastructure before failures occur.</p>
                    </div>
                  </div>
                  <div className="benefit-card">
                    <div className="benefit-icon">📱</div>
                    <div className="benefit-text">
                      <strong>Consumer Satisfaction</strong>
                      <p>Auto-generated outage notifications + accurate ETAs improve public trust and reduce complaint center load.</p>
                    </div>
                  </div>
                  <div className="benefit-card">
                    <div className="benefit-icon">🤖</div>
                    <div className="benefit-text">
                      <strong>AI-Powered Explanations</strong>
                      <p>The "Explain This Ticket" feature uses GPT-4o-mini to generate human-readable fault summaries for non-technical operators.</p>
                    </div>
                  </div>
                </div>

                <h3>Real-World Scale</h3>
                <div className="study-card">
                  <div className="study-card-icon">🌍</div>
                  <div>
                    <strong>Indian Distribution Network Context</strong>
                    <p>India has ~4,000+ DISCOMs/utilities managing 250+ million poles. Current AT&C losses are 15-20%. Even a 1% improvement through faster fault response saves billions in revenue annually.</p>
                    <p>Government programs like <strong>RDSS (Revamped Distribution Sector Scheme)</strong> and <strong>Smart Grid Mission</strong> actively fund IoT-based distribution monitoring — this system fits directly into those frameworks.</p>
                  </div>
                </div>
              </div>
            )}

            {/* --- IMPLEMENTATION TAB --- */}
            {studyTab === 'implementation' && (
              <div className="study-section">
                <h3>What's Needed to Deploy This</h3>

                <div className="impl-phase">
                  <div className="impl-phase-header">
                    <span className="impl-phase-num">Phase 1</span>
                    <strong>Hardware & Sensors</strong>
                    <span className="impl-duration">3-6 months</span>
                  </div>
                  <div className="impl-phase-body">
                    <table className="study-table">
                      <thead>
                        <tr><th>Component</th><th>Purpose</th><th>Est. Cost/Unit</th></tr>
                      </thead>
                      <tbody>
                        <tr><td>Pole-mounted sensor (CT clamp)</td><td>Detects energized/not (1-bit)</td><td>₹800-1,500</td></tr>
                        <tr><td>Communication module (NB-IoT/LoRa)</td><td>Transmits heartbeat to cloud</td><td>₹500-1,000</td></tr>
                        <tr><td>Solar cell + supercap</td><td>Powers sensor independently</td><td>₹300-600</td></tr>
                        <tr><td>GPS module (optional)</td><td>Auto-locate pole position</td><td>₹200-400</td></tr>
                        <tr><td>Weatherproof enclosure (IP65)</td><td>Protect from rain, dust, heat</td><td>₹200-400</td></tr>
                      </tbody>
                    </table>
                    <div className="impl-note">💡 Total per pole: ₹2,000-3,900 (~$25-50 USD). For a 3,800-pole network: ₹76L - ₹1.5Cr</div>
                  </div>
                </div>

                <div className="impl-phase">
                  <div className="impl-phase-header">
                    <span className="impl-phase-num">Phase 2</span>
                    <strong>Backend Infrastructure</strong>
                    <span className="impl-duration">1-2 months</span>
                  </div>
                  <div className="impl-phase-body">
                    <div className="impl-checklist">
                      <div className="impl-check">✅ <strong>Cloud Server</strong> — AWS/Azure/GCP or on-premise SCADA center. This system runs on a single 4-core VM.</div>
                      <div className="impl-check">✅ <strong>PostgreSQL Database</strong> — Stores topology, telemetry history, tickets. ~10GB for a 5,000-pole network.</div>
                      <div className="impl-check">✅ <strong>API Gateway</strong> — Receives sensor heartbeats via HTTPS/MQTT. Rate: ~130 req/s for 3,800 devices at 30s intervals.</div>
                      <div className="impl-check">✅ <strong>SSE Event Stream</strong> — Real-time push to operator console. No polling needed.</div>
                      <div className="impl-check">✅ <strong>AI Service (Optional)</strong> — OpenAI API key for the "Explain This Ticket" feature. Cost: ~$0.01/explanation.</div>
                    </div>
                  </div>
                </div>

                <div className="impl-phase">
                  <div className="impl-phase-header">
                    <span className="impl-phase-num">Phase 3</span>
                    <strong>Network Survey & Topology</strong>
                    <span className="impl-duration">2-4 months</span>
                  </div>
                  <div className="impl-phase-body">
                    <div className="impl-checklist">
                      <div className="impl-check">📍 <strong>GPS Survey</strong> — Record lat/lon of each pole, DT, and substation. Can use smartphone GPS (±3m accuracy sufficient).</div>
                      <div className="impl-check">🔗 <strong>Connection Mapping</strong> — Document which poles connect to which DT, which DTs connect to which feeder. ~40% of DTs may already have this in GIS.</div>
                      <div className="impl-check">🤖 <strong>Auto-Topology Inference</strong> — For the 60% without surveyed ordering, this system uses GPS-based greedy tree construction to infer the topology automatically.</div>
                      <div className="impl-check">✏️ <strong>Seed Data</strong> — Load pole/DT/feeder data into the database. The system provides a seed script for this.</div>
                    </div>
                  </div>
                </div>

                <div className="impl-phase">
                  <div className="impl-phase-header">
                    <span className="impl-phase-num">Phase 4</span>
                    <strong>Integration & Training</strong>
                    <span className="impl-duration">1-2 months</span>
                  </div>
                  <div className="impl-phase-body">
                    <div className="impl-checklist">
                      <div className="impl-check">🔌 <strong>SCADA/DMS Integration</strong> — Connect to existing Outage Management System (OMS) via REST API. This system exposes standard REST endpoints.</div>
                      <div className="impl-check">📞 <strong>SMS/WhatsApp Alerts</strong> — Wire ticket creation events to notification services for field crews.</div>
                      <div className="impl-check">📊 <strong>Dashboard & Reporting</strong> — Plug into existing BI tools (PowerBI, Grafana) for SAIDI/SAIFI tracking.</div>
                      <div className="impl-check">🎓 <strong>Operator Training</strong> — Train control room staff on the console. The Study panel itself serves as training material.</div>
                      <div className="impl-check">🧪 <strong>Pilot Testing</strong> — Deploy on one feeder (100-200 poles) first. Validate detection accuracy before full rollout.</div>
                    </div>
                  </div>
                </div>

                <h3>Architecture Overview</h3>
                <div className="study-card solution">
                  <pre className="study-code" style={{ fontSize: '10px' }}>{`┌─────────────┐    NB-IoT/LoRa    ┌──────────────┐
│  Pole Sensor │───────────────────│  API Gateway  │
│  (CT clamp)  │   heartbeat/30s   │  (FastAPI)    │
└─────────────┘                   └──────┬───────┘
                                         │
        ┌────────────────────────────────┼────────────────┐
        │                                │                │
   ┌────▼────┐  ┌──────────────┐  ┌─────▼──────┐  ┌─────▼──────┐
   │ Telemetry│  │  Topology    │  │  Fault     │  │  Ticket    │
   │ Ingestion│  │  Engine      │  │  Localize  │  │  Manager   │
   │         │  │ (GPS→Tree)   │  │ (BFS+DFS)  │  │ (Lifecycle)│
   └────┬────┘  └──────────────┘  └─────┬──────┘  └─────┬──────┘
        │                                │                │
        └────────────────┬───────────────┘                │
                         │                                │
                   ┌─────▼──────┐                   ┌────▼─────┐
                   │ PostgreSQL │                   │ SSE Push │
                   │  Database  │                   │ → Console│
                   └────────────┘                   └──────────┘`}</pre>
                </div>

                <h3>Regulatory Compliance</h3>
                <div className="study-algo-block">
                  <div className="algo-header">
                    <span className="algo-badge tree">POLICY</span>
                    <strong>Government Frameworks This Fits Into</strong>
                  </div>
                  <ul>
                    <li><strong>RDSS (Revamped Distribution Sector Scheme)</strong> — ₹3.03 lakh crore for smart metering and distribution automation. This system qualifies under SCADA/DMS modernization.</li>
                    <li><strong>National Smart Grid Mission (NSGM)</strong> — Promotes IoT-based grid monitoring. Fault localization is a core smart grid function.</li>
                    <li><strong>CEA (Technical Standards)</strong> — Central Electricity Authority mandates outage reporting. This system automates it with auditable ticket trails.</li>
                    <li><strong>SERC Quality of Service</strong> — State regulators penalize DISCOMs for high SAIDI/SAIFI. This system directly reduces both metrics.</li>
                    <li><strong>Electricity Act 2003, Section 57</strong> — Obligates licensees to supply quality power. Fault localization supports compliance.</li>
                  </ul>
                </div>

                <h3>ROI Estimate</h3>
                <table className="study-table">
                  <thead>
                    <tr><th>Metric</th><th>Before</th><th>After</th><th>Impact</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Fault Detection Time</td><td>30-60 min</td><td>10-60 sec</td><td className="text-live">~98% faster</td></tr>
                    <tr><td>Crew Dispatch Accuracy</td><td>Trial & error</td><td>Exact span</td><td className="text-live">Direct to site</td></tr>
                    <tr><td>MTTR (Mean Time To Repair)</td><td>4-8 hours</td><td>1-2 hours</td><td className="text-live">~70% reduction</td></tr>
                    <tr><td>Revenue Loss per Outage</td><td>₹50K-2L/hr</td><td>₹10K-40K/hr</td><td className="text-live">~80% less</td></tr>
                    <tr><td>Sensor Deployment Cost</td><td>—</td><td>₹2-4K/pole</td><td>One-time CAPEX</td></tr>
                    <tr><td>Payback Period</td><td>—</td><td>—</td><td className="text-live">6-12 months</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
