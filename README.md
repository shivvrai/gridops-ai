# Fault Localization System

A deterministic fault localization system for power distribution networks. Detects, localizes, and manages outage faults using IoT telemetry from pole-mounted devices.

## Quick Start

```bash
# One-command startup — creates DB, seeds network, starts all services
docker compose up --build

# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API docs: http://localhost:8000/docs
```

### Without Docker (development)

```bash
# Backend
cd backend
pip install -r requirements.txt
# Start Postgres locally on port 5432 with DB "faultloc"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

## What This Does

A power utility has IoT devices on ~91% of distribution poles reporting one bit: energized or not. Power is distributed as a radial tree (substation → feeder → DT → poles). When a line segment fails, everything downstream goes dark.

This system:
1. **Ingests telemetry** (heartbeat, power_lost, power_restored) from ~3,800 pole devices
2. **Infers topology** for the 60% of distribution transformers without surveyed pole ordering using GPS-based greedy tree construction
3. **Detects faults** via a 10-second periodic sweep with adaptive confirmation (corroboration short-circuit + 60s default window)
4. **Localizes faults** by walking the network tree to find live→dark boundaries
5. **Creates tickets** with the span, DT, or feeder containing the fault, including confidence labels and affected pole counts
6. **Manages lifecycle** through a state machine (detected → acknowledged → crew_assigned → resolved → verified → closed)
7. **Pushes real-time updates** via SSE to the operator console

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full system design.

## Testing

```bash
cd backend
python -m pytest tests/ -v
```

All 10 localization tests pass:
- Single span fault → one correctly located ticket
- DT-level fault → one DT ticket
- Three simultaneous faults → three tickets
- Dead sensor with live children → device anomaly, not fault
- Scheduled outage → suppressed
- Confirmation window → no premature detection
- Corroboration short-circuit → fast detection
- Confidence labelling (HIGH/MEDIUM/LOW)

## Environment Variables

See [.env.example](.env.example) for all configuration options.

## AI Feature

The "Explain This Ticket" feature calls GPT-4o-mini to generate a plain-language explanation of each fault ticket. Falls back to a structured summary when the API key is not configured or the LLM is unavailable.

Set `OPENAI_API_KEY` in `.env` to enable AI explanations.

## Simulator

The built-in simulator supports:
- **Span faults** — wire break between two poles
- **DT faults** — transformer failure (all poles dark)
- **Feeder faults** — 11kV line failure (all DTs dark)
- **Device death** — sensor fails, power is fine (should NOT create a ticket)
- **Repair** — affected poles come back online
- Realistic noise: 30% missed dying messages, fw 1.2 silent devices, duplicates, clock skew
