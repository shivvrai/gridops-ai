"""Scheduled outage management API — CRUD for load shedding and maintenance windows."""
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import get_db
from app.models.schemas import ScheduledOutage
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/scheduled-outages", tags=["outages"])


class CreateOutageRequest(BaseModel):
    scope: str  # "feeder" or "dt"
    target_id: str  # feeder_id or dt_id
    reason: str = "Scheduled maintenance"
    scheduled_start: str  # ISO datetime
    scheduled_end: str  # ISO datetime


def _to_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


@router.get("")
@router.get("/")
async def list_outages(
    active_only: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """List scheduled outages. By default shows only active/upcoming ones."""
    now = datetime.now(timezone.utc)

    query = select(ScheduledOutage).order_by(ScheduledOutage.scheduled_start.desc())

    if active_only:
        # Show outages that haven't ended yet (including grace period)
        query = query.where(
            ScheduledOutage.grace_end >= now,
            ScheduledOutage.cancelled == False,
        )

    result = await db.execute(query)
    outages = result.scalars().all()

    outage_list = []
    for o in outages:
        start_utc = _to_utc(o.scheduled_start)
        grace_utc = _to_utc(o.grace_end)
        is_active = (
            start_utc <= now <= grace_utc
            if start_utc and grace_utc and not o.cancelled
            else False
        )
        outage_list.append({
            "outage_id": o.outage_id,
            "scope": o.scope,
            "target_id": o.target_id,
            "reason": o.reason,
            "scheduled_start": start_utc.isoformat() if start_utc else None,
            "scheduled_end": _to_utc(o.scheduled_end).isoformat() if o.scheduled_end else None,
            "grace_end": grace_utc.isoformat() if grace_utc else None,
            "cancelled": o.cancelled,
            "is_active": is_active,
        })

    return outage_list


@router.post("")
@router.post("/")
async def create_outage(
    request: CreateOutageRequest,
    db: AsyncSession = Depends(get_db),
):
    """Create a new scheduled outage for fault suppression."""
    if request.scope not in ("feeder", "dt"):
        raise HTTPException(status_code=400, detail="scope must be 'feeder' or 'dt'")

    try:
        start = datetime.fromisoformat(request.scheduled_start)
        end = datetime.fromisoformat(request.scheduled_end)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid datetime format. Use ISO format.")

    if end <= start:
        raise HTTPException(status_code=400, detail="scheduled_end must be after scheduled_start")

    grace_end = end + timedelta(minutes=settings.grace_period_minutes)
    outage_id = f"SO-{uuid.uuid4().hex[:8].upper()}"

    outage = ScheduledOutage(
        outage_id=outage_id,
        scope=request.scope,
        target_id=request.target_id,
        reason=request.reason,
        scheduled_start=start,
        scheduled_end=end,
        grace_end=grace_end,
    )
    db.add(outage)
    await db.commit()
    await db.refresh(outage)

    # Register in the engine's active outages for real-time suppression
    from app.main import app_state
    engine = app_state.get("engine")
    if engine:
        engine.active_outages[request.target_id] = {
            "outage_id": outage_id,
            "scope": request.scope,
            "target_id": request.target_id,
            "scheduled_start": start,
            "grace_end": grace_end,
            "cancelled": False,
        }

    logger.info(f"Scheduled outage created: {request.scope}/{request.target_id} "
                f"from {start} to {end}")

    return {
        "status": "created",
        "outage_id": outage_id,
        "scope": outage.scope,
        "target_id": outage.target_id,
        "scheduled_start": start.isoformat(),
        "scheduled_end": end.isoformat(),
        "grace_end": grace_end.isoformat(),
    }


@router.delete("/{outage_id}")
async def cancel_outage(outage_id: str, db: AsyncSession = Depends(get_db)):
    """Cancel a scheduled outage."""
    result = await db.execute(
        select(ScheduledOutage).where(ScheduledOutage.outage_id == outage_id)
    )
    outage = result.scalar_one_or_none()
    if not outage:
        raise HTTPException(status_code=404, detail=f"Outage {outage_id} not found")

    outage.cancelled = True
    await db.commit()

    # Remove from engine suppression cache
    from app.main import app_state
    engine = app_state.get("engine")
    if engine and outage.target_id in engine.active_outages:
        engine.active_outages[outage.target_id]["cancelled"] = True

    logger.info(f"Scheduled outage cancelled: {outage.scope}/{outage.target_id}")

    return {"status": "cancelled", "outage_id": outage_id}
