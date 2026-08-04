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

export default function NetworkCanvas({ poles, dts, edges: initialEdges, tickets, selectedTicket, onInjectFault, onRepairSingle, onRepairAll }) {
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

  // Master ref — read by animation loop & handlers without stale closures
  const S = useRef({})
  S.current = { mode, nodes, edges, transform, selected, selectedSet, wireStart, mouseWorld, boundaries, counters, dragging, panStart, lasso, faultIds }

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

  /* ---- Import backend data once ---- */
  useEffect(() => {
    if (importedRef.current || (poles.length === 0 && dts.length === 0)) return
    const r = containerRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return
    importedRef.current = true

    const W = r.width, H = r.height
    const all = [...poles.map(p => ({ lat: p.lat, lon: p.lon })), ...dts.map(d => ({ lat: d.lat, lon: d.lon }))]
    const lats = all.map(i => i.lat).filter(Boolean), lons = all.map(i => i.lon).filter(Boolean)
    if (!lats.length) return

    const [mnLa, mxLa] = [Math.min(...lats), Math.max(...lats)]
    const [mnLo, mxLo] = [Math.min(...lons), Math.max(...lons)]
    const laR = mxLa - mnLa || 0.001, loR = mxLo - mnLo || 0.001
    const mg = 80
    const tX = lon => mg + ((lon - mnLo) / loR) * (W - mg * 2)
    const tY = lat => mg + ((mxLa - lat) / laR) * (H - mg * 2)

    const nn = []
    dts.forEach(dt => nn.push({ id: `bdt-${dt.dt_id}`, type: 'dt', x: tX(dt.lon), y: tY(dt.lat), label: dt.dt_id, status: 'live', meta: dt }))
    poles.forEach(p => nn.push({ id: `bp-${p.pole_id}`, type: 'pole', x: tX(p.lon), y: tY(p.lat), label: p.pole_id, status: p.status || 'live', meta: p, isFault: p.status === 'fault' }))

    const ne = []
    initialEdges.forEach((e, i) => {
      const fx = tX(e.from_lon), fy = tY(e.from_lat), tx = tX(e.to_lon), ty = tY(e.to_lat)
      let fromN = null, toN = null, fd = Infinity, td = Infinity
      nn.forEach(n => {
        const d1 = (n.x - fx) ** 2 + (n.y - fy) ** 2, d2 = (n.x - tx) ** 2 + (n.y - ty) ** 2
        if (d1 < fd) { fd = d1; fromN = n }
        if (d2 < td) { td = d2; toN = n }
      })
      if (fromN && toN && fromN.id !== toN.id) {
        ne.push({ id: `be-${i}`, from: fromN.id, to: toN.id, type: autoEdgeType(fromN, toN), status: e.status || 'live' })
      }
    })

    setNodes(nn); setEdges(ne)
    setCounters({ pole: poles.length, dt: dts.length, home: 0 })
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

      s.edges.forEach(e => drawEdgeLine(ctx, e, nm[e.from], nm[e.to], flow, time, s.selectedSet.has(e.id)))

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
      s.nodes.forEach(n => drawNode(ctx, n, s.selected?.id === n.id, s.selectedSet.has(n.id), bIds.has(n.id), time))

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

  const handleSolve = () => setBoundaries(solveFault(nodes, edges))

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
    </div>
  )
}
