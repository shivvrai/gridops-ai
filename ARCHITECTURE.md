# Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                     Frontend (React)                     │
│  Leaflet Map │ Ticket List │ Ticket Detail │ Simulator  │
│              │             │    + AI       │  Controls  │
└──────────────────┬─────────────┬────────────────────────┘
                   │ HTTP/SSE    │
┌──────────────────┴─────────────┴────────────────────────┐
│                  Backend (FastAPI)                        │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ Telemetry│  │ Localization │  │  Ticket Manager  │   │
│  │ Ingest   │→ │   Engine     │→ │ (State Machine)  │   │
│  └──────────┘  └──────────────┘  └──────────────────┘   │
│       ↑              ↑                    ↓              │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │Simulator │  │  Topology    │  │  SSE Broadcast   │   │
│  │ Engine   │  │  Inference   │  │                  │   │
│  └──────────┘  └──────────────┘  └──────────────────┘   │
│                        ↑                                 │
│                   ┌────┴────┐                            │
│                   │NetworkX │                            │
│                   │  Graph  │                            │
│                   └─────────┘                            │
└──────────────────┬───────────────────────────────────────┘
                   │ async SQLAlchemy
              ┌────┴────┐
              │Postgres  │
              │ (pgdata) │
              └──────────┘
```

## Component Responsibilities

### Telemetry Ingest (`app/api/telemetry.py`)
Receives `heartbeat`, `power_lost`, `power_restored`, `boot` events from pole devices. Performs de-duplication (device_id + seq tracking, boot-reset handling) and routes to the localization engine.

### Localization Engine (`app/core/localization.py`)
The highest-weighted component. Four-stage pipeline:

1. **De-duplication**: Sequence-number tracking per device with boot-reset handling
2. **Adaptive Confirmation**: 60s default window with corroboration short-circuit (≥3 poles on same DT suspected within 30s → immediate promotion)
3. **Boundary Detection**: Tree walk from DT root, finding live→dark frontiers
4. **Grouping**: Separate span, DT, and feeder faults; merge DT-level to feeder-level when all DTs on a feeder are dark

Driven by a 10-second periodic sweep (not per-pole timers).

### Topology Inference (`app/core/topology.py`)
For the 60% of DTs without surveyed pole ordering:
- GPS-based greedy tree construction (Prim's-like, rooted at DT)
- Adaptive per-DT distance threshold (mean NN distance + 3σ)
- Soft directional penalty for sharp doubling-back (confidence downgrade, not rejection)
- KD-tree for O(n log n) nearest-neighbour lookups

### Ticket Manager (`app/core/ticket_manager.py`)
State machine enforcing valid lifecycle transitions:
```
detected → acknowledged → crew_assigned → resolved → verified → closed
```
- Premature "resolved" rejected if any affected poles are still dark
- Auto-verification when telemetry confirms all poles are energized
- Cascaded fault re-detection triggered after partial restoration

### Fault Simulator (`app/core/simulator.py`)
Generates realistic telemetry with noise:
- 30% missed dying messages
- fw 1.2 devices don't send `power_lost`
- ~10% duplicates
- Out-of-order timestamps with ±90s clock skew

### Real-Time Push (`app/api/events.py`)
Server-Sent Events (SSE) chosen over WebSockets to avoid proxy-upgrade failures in Docker/nginx deployments. Simple pub-sub with per-subscriber queues.

### AI Feature (`app/api/ai.py`)
"Explain This Ticket" — on-demand natural-language summary via GPT-4o-mini. Strictly read-only, never influences localization. Falls back to structured summary when LLM is unavailable.

## Data Model

### Network Hierarchy
`Substation → Feeder → DistributionTransformer → Pole`

### Key Tables
| Table | Purpose |
|-------|---------|
| `substations` | 4 substations with GPS |
| `feeders` | ~31 feeders linked to substations |
| `distribution_transformers` | ~412 DTs with surveyed/inferred flag |
| `poles` | ~3,800 poles with GPS, device_id, topology source |
| `telemetry_events` | Raw event log (BIGSERIAL PK) |
| `pole_states` | Current state per pole |
| `tickets` | Fault tickets (BIGSERIAL PK, display_id for humans) |
| `ticket_affected_poles` | Junction table: ticket ↔ affected poles |
| `scheduled_outages` | Outage windows for suppression |

## Design Decisions

See [DECISIONS.md](DECISIONS.md) for the full decision log.
