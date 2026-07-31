"""Simulator API endpoints — drivable from the UI."""
import logging
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/simulator", tags=["simulator"])


class SpanFaultRequest(BaseModel):
    dt_id: str
    fault_after_pole: Optional[str] = None
    message_loss_rate: float = 0.30


class DTFaultRequest(BaseModel):
    dt_id: str
    message_loss_rate: float = 0.30


class FeederFaultRequest(BaseModel):
    feeder_id: str
    message_loss_rate: float = 0.30


class DeviceDeathRequest(BaseModel):
    pole_id: str


class RepairRequest(BaseModel):
    dt_id: str
    affected_poles: Optional[list[str]] = None


@router.post("/fault/span")
async def inject_span_fault(
    request: SpanFaultRequest,
    db: AsyncSession = Depends(get_db),
):
    """Inject a span fault on a DT line."""
    from app.main import app_state

    simulator = app_state["simulator"]
    engine = app_state["engine"]

    events = simulator.inject_span_fault(
        dt_id=request.dt_id,
        fault_after_pole=request.fault_after_pole,
        message_loss_rate=request.message_loss_rate,
    )

    # Process events through the engine
    processed = 0
    for evt in events:
        from datetime import datetime, timezone
        try:
            ts = datetime.fromisoformat(evt["ts"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            ts = datetime.now(timezone.utc)

        ok = engine.process_event(
            pole_id=evt["pole_id"],
            device_id=evt["device_id"],
            event=evt["event"],
            energized=evt["energized"],
            ts=ts,
            seq=evt["seq"],
            fw=evt.get("fw"),
            battery_mv=evt.get("battery_mv"),
            rssi=evt.get("rssi"),
        )
        if ok:
            processed += 1

    return {
        "status": "injected",
        "fault_type": "span",
        "dt_id": request.dt_id,
        "events_generated": len(events),
        "events_processed": processed,
        "note": "Fault will be detected on next localization sweep (~10s)"
    }


@router.post("/fault/dt")
async def inject_dt_fault(
    request: DTFaultRequest,
    db: AsyncSession = Depends(get_db),
):
    """Inject a DT-level fault (transformer failure)."""
    from app.main import app_state

    simulator = app_state["simulator"]
    engine = app_state["engine"]

    events = simulator.inject_dt_fault(
        dt_id=request.dt_id,
        message_loss_rate=request.message_loss_rate,
    )

    processed = 0
    for evt in events:
        from datetime import datetime, timezone
        try:
            ts = datetime.fromisoformat(evt["ts"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            ts = datetime.now(timezone.utc)

        ok = engine.process_event(
            pole_id=evt["pole_id"],
            device_id=evt["device_id"],
            event=evt["event"],
            energized=evt["energized"],
            ts=ts,
            seq=evt["seq"],
            fw=evt.get("fw"),
        )
        if ok:
            processed += 1

    return {
        "status": "injected",
        "fault_type": "dt",
        "dt_id": request.dt_id,
        "events_generated": len(events),
        "events_processed": processed,
    }


@router.post("/fault/feeder")
async def inject_feeder_fault(
    request: FeederFaultRequest,
    db: AsyncSession = Depends(get_db),
):
    """Inject a feeder-level fault."""
    from app.main import app_state

    simulator = app_state["simulator"]
    engine = app_state["engine"]

    events = simulator.inject_feeder_fault(
        feeder_id=request.feeder_id,
        message_loss_rate=request.message_loss_rate,
    )

    processed = 0
    for evt in events:
        from datetime import datetime, timezone
        try:
            ts = datetime.fromisoformat(evt["ts"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            ts = datetime.now(timezone.utc)

        ok = engine.process_event(
            pole_id=evt["pole_id"],
            device_id=evt["device_id"],
            event=evt["event"],
            energized=evt["energized"],
            ts=ts,
            seq=evt["seq"],
            fw=evt.get("fw"),
        )
        if ok:
            processed += 1

    return {
        "status": "injected",
        "fault_type": "feeder",
        "feeder_id": request.feeder_id,
        "events_generated": len(events),
        "events_processed": processed,
    }


@router.post("/device/death")
async def inject_device_death(
    request: DeviceDeathRequest,
    db: AsyncSession = Depends(get_db),
):
    """Simulate a device dying while power is fine."""
    from app.main import app_state

    simulator = app_state["simulator"]
    simulator.inject_device_death(pole_id=request.pole_id)

    return {
        "status": "injected",
        "event_type": "device_death",
        "pole_id": request.pole_id,
        "note": "Device will stop sending heartbeats. Should NOT create a fault ticket."
    }


@router.post("/repair")
async def repair_fault(
    request: RepairRequest,
    db: AsyncSession = Depends(get_db),
):
    """Simulate fault repair — affected poles come back online."""
    from app.main import app_state

    simulator = app_state["simulator"]
    engine = app_state["engine"]

    events = simulator.repair_fault(
        dt_id=request.dt_id,
        affected_poles=request.affected_poles,
    )

    processed = 0
    for evt in events:
        from datetime import datetime, timezone
        try:
            ts = datetime.fromisoformat(evt["ts"].replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            ts = datetime.now(timezone.utc)

        ok = engine.process_event(
            pole_id=evt["pole_id"],
            device_id=evt["device_id"],
            event=evt["event"],
            energized=evt["energized"],
            ts=ts,
            seq=evt["seq"],
            fw=evt.get("fw"),
        )
        if ok:
            processed += 1

    return {
        "status": "repaired",
        "dt_id": request.dt_id,
        "events_generated": len(events),
        "events_processed": processed,
        "note": "Tickets should auto-verify on next sweep if all poles are live."
    }


@router.get("/network/info")
async def get_network_info():
    """Get network topology summary for the simulator UI."""
    from app.main import app_state

    engine = app_state["engine"]
    if not engine.network_graph:
        return {"error": "Network not loaded"}

    G = engine.network_graph

    substations = [n for n in G.nodes if G.nodes[n].get("node_type") == "substation"]
    feeders = [n for n in G.nodes if G.nodes[n].get("node_type") == "feeder"]
    dts = [n for n in G.nodes if G.nodes[n].get("node_type") == "dt"]
    poles = [n for n in G.nodes if G.nodes[n].get("node_type") == "pole"]

    # Build hierarchy for the UI
    hierarchy = []
    for sub_id in substations:
        sub_feeders = []
        for feeder_id in G.successors(sub_id):
            if G.nodes[feeder_id].get("node_type") != "feeder":
                continue
            feeder_dts = []
            for dt_id in G.successors(feeder_id):
                if G.nodes[dt_id].get("node_type") != "dt":
                    continue
                dt_data = G.nodes[dt_id]
                dt_poles = [n for n in G.successors(dt_id)
                           if G.nodes[n].get("node_type") == "pole"]
                feeder_dts.append({
                    "dt_id": dt_id,
                    "lat": dt_data.get("lat"),
                    "lon": dt_data.get("lon"),
                    "pole_count": len(dt_poles),
                    "has_surveyed_topology": dt_data.get("has_surveyed_topology", False),
                })
            sub_feeders.append({
                "feeder_id": feeder_id,
                "dt_count": len(feeder_dts),
                "dts": feeder_dts,
            })
        hierarchy.append({
            "substation_id": sub_id,
            "feeders": sub_feeders,
        })

    return {
        "substations": len(substations),
        "feeders": len(feeders),
        "dts": len(dts),
        "poles": len(poles),
        "poles_with_device": sum(1 for p in poles if G.nodes[p].get("device_id")),
        "surveyed_dts": sum(1 for d in dts if G.nodes[d].get("has_surveyed_topology")),
        "hierarchy": hierarchy,
    }


@router.get("/poles")
async def get_poles():
    """Get all poles with their current state for the map view."""
    from app.main import app_state

    engine = app_state["engine"]
    if not engine.network_graph:
        return []

    G = engine.network_graph
    poles = []

    for node_id in G.nodes:
        data = G.nodes[node_id]
        if data.get("node_type") != "pole":
            continue

        state = engine.pole_states.get(node_id)
        poles.append({
            "pole_id": node_id,
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "dt_id": data.get("dt_id"),
            "feeder_id": data.get("feeder_id"),
            "device_id": data.get("device_id"),
            "pincode": data.get("pincode"),
            "ward": data.get("ward"),
            "topology_source": data.get("topology_source"),
            "status": state.status if state else "unknown",
            "has_device": data.get("device_id") is not None,
        })

    return poles


@router.get("/dts")
async def get_dts():
    """Get all DTs for the map view."""
    from app.main import app_state

    engine = app_state["engine"]
    if not engine.network_graph:
        return []

    G = engine.network_graph
    dts = []

    for node_id in G.nodes:
        data = G.nodes[node_id]
        if data.get("node_type") != "dt":
            continue

        dts.append({
            "dt_id": node_id,
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "feeder_id": data.get("feeder_id"),
            "has_surveyed_topology": data.get("has_surveyed_topology", False),
            "households_served": data.get("households_served", 0),
        })

    return dts


@router.get("/edges")
async def get_edges():
    """Get network edges for the map view (pole-to-pole connections)."""
    from app.main import app_state

    engine = app_state["engine"]
    if not engine.network_graph:
        return []

    G = engine.network_graph
    edges = []

    for u, v, data in G.edges(data=True):
        if data.get("edge_type") != "span":
            continue
        u_data = G.nodes.get(u, {})
        v_data = G.nodes.get(v, {})

        if not (u_data.get("lat") and v_data.get("lat")):
            # Skip edges where one node doesn't have coordinates (DT→pole edges use DT coords)
            if u_data.get("node_type") == "dt":
                u_lat, u_lon = u_data.get("lat"), u_data.get("lon")
            else:
                continue
        else:
            u_lat, u_lon = u_data.get("lat"), u_data.get("lon")

        edges.append({
            "from": u,
            "to": v,
            "from_lat": u_lat,
            "from_lon": u_lon,
            "to_lat": v_data.get("lat"),
            "to_lon": v_data.get("lon"),
            "topology_source": data.get("topology_source", "unknown"),
            "topology_confidence": data.get("topology_confidence", "MEDIUM"),
        })

    return edges
