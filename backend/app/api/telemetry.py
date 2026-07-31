"""Telemetry ingestion API endpoint."""
import logging
from datetime import datetime, timezone
from pydantic import BaseModel
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.database import get_db
from app.models.schemas import TelemetryEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/telemetry", tags=["telemetry"])


class TelemetryPayload(BaseModel):
    device_id: str
    pole_id: str
    event: str  # heartbeat | power_lost | power_restored | boot
    energized: bool
    ts: str
    seq: int
    battery_mv: Optional[int] = None
    rssi: Optional[int] = None
    fw: Optional[str] = None


class BulkTelemetryPayload(BaseModel):
    events: list[TelemetryPayload]


@router.post("/ingest")
async def ingest_telemetry(
    payload: TelemetryPayload,
    db: AsyncSession = Depends(get_db),
):
    """Ingest a single telemetry event from a pole device."""
    from app.main import app_state

    engine = app_state["engine"]

    # Parse timestamp
    try:
        ts = datetime.fromisoformat(payload.ts.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        ts = datetime.now(timezone.utc)

    # Process through localization engine (de-dup + state update)
    processed = engine.process_event(
        pole_id=payload.pole_id,
        device_id=payload.device_id,
        event=payload.event,
        energized=payload.energized,
        ts=ts,
        seq=payload.seq,
        fw=payload.fw,
        battery_mv=payload.battery_mv,
        rssi=payload.rssi,
    )

    if not processed:
        return {"status": "duplicate", "pole_id": payload.pole_id}

    # Store in DB (non-blocking for the response)
    telemetry = TelemetryEvent(
        device_id=payload.device_id,
        pole_id=payload.pole_id,
        event=payload.event,
        energized=payload.energized,
        ts=ts,
        seq=payload.seq,
        battery_mv=payload.battery_mv,
        rssi=payload.rssi,
        fw=payload.fw,
    )
    db.add(telemetry)
    await db.commit()

    return {"status": "accepted", "pole_id": payload.pole_id}


@router.post("/ingest/bulk")
async def ingest_bulk_telemetry(
    payload: BulkTelemetryPayload,
    db: AsyncSession = Depends(get_db),
):
    """Ingest multiple telemetry events (used by simulator)."""
    from app.main import app_state

    engine = app_state["engine"]
    accepted = 0
    duplicates = 0

    for evt in payload.events:
        try:
            ts = datetime.fromisoformat(evt.ts.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            ts = datetime.now(timezone.utc)

        processed = engine.process_event(
            pole_id=evt.pole_id,
            device_id=evt.device_id,
            event=evt.event,
            energized=evt.energized,
            ts=ts,
            seq=evt.seq,
            fw=evt.fw,
            battery_mv=evt.battery_mv,
            rssi=evt.rssi,
        )

        if processed:
            accepted += 1
            telemetry = TelemetryEvent(
                device_id=evt.device_id,
                pole_id=evt.pole_id,
                event=evt.event,
                energized=evt.energized,
                ts=ts,
                seq=evt.seq,
                battery_mv=evt.battery_mv,
                rssi=evt.rssi,
                fw=evt.fw,
            )
            db.add(telemetry)
        else:
            duplicates += 1

    await db.commit()

    return {
        "status": "accepted",
        "total": len(payload.events),
        "accepted": accepted,
        "duplicates": duplicates,
    }
