# Decisions Log

Running record of engineering decisions, their reasoning, and alternatives considered.

---

### 1. Greedy DT-outward tree over MST for topology inference
**Decision**: Use GPS-based greedy tree construction rooted at DT instead of MST.
**Why**: Simpler to implement, easier to debug, deterministic, and sufficient for the assignment. Both are heuristics with similar limitations when GPS is noisy. The real mitigation is confidence scoring and graceful degradation — the system reports inferred topology and downgrades confidence accordingly.
**Alternative**: Kruskal/Prim MST, then root at DT. Similar accuracy but more complex implementation for no material benefit.

---

### 2. Adaptive per-DT distance threshold (mean NN + 3σ)
**Decision**: Each DT computes its own distance threshold from its poles' nearest-neighbour distribution.
**Why**: DTs vary dramatically — rural DTs have 40-60m spacing, urban DTs have 25-35m. A single global threshold would either miss edges in rural areas or create false edges in dense areas.
**Alternative**: Fixed 80m global threshold. Simple but fragile.

---

### 3. 10-second periodic sweep over per-pole timers
**Decision**: Single background task runs every 10s, iterating only over dirty DTs.
**Why**: Timer-per-device (up to ~38,400 timers) creates O(n) memory/CPU pressure and makes race conditions hard to reason about. Periodic sweep is O(dirty DTs), deterministic, and easy to test.
**Alternative**: Timer per device with debouncing. More responsive but much harder to maintain.

---

### 4. Corroboration short-circuit (≥3 poles in 30s → immediate promotion)
**Decision**: When 3+ poles on the same DT report suspected_dark within 30s, skip the 60s confirmation window.
**Why**: A real fault causes a burst of power_lost events. Waiting 60s for each one wastes critical response time. Corroboration provides strong evidence of a real fault.
**Alternative**: Fixed confirmation window for all faults. Simpler but adds 45s latency to best-case detection.

---

### 5. Categorical confidence (HIGH/MEDIUM/LOW) over numeric scores
**Decision**: Label confidence using observable criteria, not numeric thresholds.
**Why**: A numeric score (e.g., 0.73) invites "why not 0.74?" and is hard to calibrate without ground truth data. Categorical labels have clear, defensible criteria:
- **HIGH**: Surveyed topology + explicit power_lost + ≥2 corroborating dark poles
- **MEDIUM**: Surveyed topology OR ≥1 corroborating pole
- **LOW**: Inferred topology with uninstrumented gaps, or fw1.2 heartbeat timeout
**Alternative**: Bayesian score with priors. More theoretically elegant but impossible to calibrate for a demo.

---

### 6. SSE over WebSockets
**Decision**: Server-Sent Events for server-to-client push.
**Why**: SSE works over plain HTTP/1.1 without upgrade negotiation. WebSockets fail behind many reverse proxies and load balancers that don't support the upgrade protocol (common in Docker+nginx setups). SSE is simpler, more reliable, and sufficient since the server pushes and the client only reads.
**Alternative**: WebSockets for bidirectional communication. Overkill — the client never sends events to the server via the push channel.

---

### 7. Isolated dark pole with live children = device anomaly, not fault
**Decision**: A single dark pole whose children are all live is classified as a dead sensor/equipment issue, not a line fault.
**Why**: If power were truly off, children would also be dark. This avoids false fault tickets from faulty devices.
**Alternative**: Still create a fault ticket with LOW confidence. Noisier for operators.

---

### 8. fw 1.2 devices: ~16 minute detection latency (known limitation)
**Decision**: Document as a known limitation rather than trying to work around it.
**Why**: fw 1.2 devices don't send `power_lost` — they only send heartbeats every 15 minutes. Detection latency is 15min + 45s jitter + 15s margin ≈ 16 minutes. This is a hardware constraint; no software trick can detect faster without power_lost events.
**Alternative**: Shorter heartbeat timeout. Would create false positives for any device that's slightly late.

---

### 9. BIGSERIAL ticket PK + human-readable display_id
**Decision**: Auto-incrementing BIGSERIAL for internal PK, formatted display_id (FLT-YYYYMMDD-NNN) for operators.
**Why**: BIGSERIAL is efficient for joins and indexes. Display IDs are human-readable and sortable. Separating them avoids the "which one do I use?" problem.
**Alternative**: UUID primary key. Overkill for a single-instance system and harder to read in logs.

---

### 10. "Explain This Ticket" over shift-handoff summary
**Decision**: On-demand per-ticket explanation rather than periodic summary generation.
**Why**: Higher frequency touchpoint — operators use it multiple times per shift vs. once at handoff. Builds trust incrementally. Strictly read-only and non-blocking for the localization pipeline.
**Alternative**: Automated shift summary. Lower frequency, higher latency, harder to validate.

---

### 11. Junction table for ticket→affected_poles
**Decision**: Separate `ticket_affected_poles` table instead of JSON array on the ticket.
**Why**: Enables efficient "which tickets affect this pole?" queries, which are needed for restoration verification and cascaded fault detection.
**Alternative**: JSON array column. Simpler but can't be indexed for reverse lookups.
