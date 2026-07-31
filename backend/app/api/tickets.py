"""Ticket management API endpoints."""
import logging
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import get_db
from app.models.schemas import Ticket, TicketAffectedPole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


class TicketTransitionRequest(BaseModel):
    status: str
    operator_notes: Optional[str] = None


@router.get("/")
async def list_tickets(
    status: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """List tickets, optionally filtered by status."""
    query = select(Ticket).order_by(Ticket.detected_at.desc()).limit(limit)
    if status:
        query = query.where(Ticket.status == status)

    result = await db.execute(query)
    tickets = result.scalars().all()

    ticket_list = []
    for t in tickets:
        # Get affected poles
        poles_result = await db.execute(
            select(TicketAffectedPole.pole_id).where(
                TicketAffectedPole.ticket_id == t.ticket_id
            )
        )
        affected_poles = [r[0] for r in poles_result.all()]

        ticket_list.append({
            "ticket_id": t.ticket_id,
            "display_id": t.display_id,
            "status": t.status,
            "fault_type": t.fault_type,
            "feeder_id": t.feeder_id,
            "dt_id": t.dt_id,
            "boundary_live_pole": t.boundary_live_pole,
            "boundary_dark_pole": t.boundary_dark_pole,
            "fault_lat": t.fault_lat,
            "fault_lon": t.fault_lon,
            "pincode": t.pincode,
            "is_range": t.is_range,
            "range_description": t.range_description,
            "affected_poles": affected_poles,
            "affected_pole_count": t.affected_pole_count,
            "estimated_households": t.estimated_households,
            "confidence_label": t.confidence_label,
            "confidence_factors": t.confidence_factors,
            "topology_source": t.topology_source,
            "detected_at": t.detected_at.isoformat() if t.detected_at else None,
            "acknowledged_at": t.acknowledged_at.isoformat() if t.acknowledged_at else None,
            "crew_assigned_at": t.crew_assigned_at.isoformat() if t.crew_assigned_at else None,
            "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
            "verified_at": t.verified_at.isoformat() if t.verified_at else None,
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            "operator_notes": t.operator_notes,
        })

    return ticket_list


@router.get("/{display_id}")
async def get_ticket(display_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single ticket by display ID."""
    result = await db.execute(
        select(Ticket).where(Ticket.display_id == display_id)
    )
    ticket = result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket {display_id} not found")

    poles_result = await db.execute(
        select(TicketAffectedPole.pole_id).where(
            TicketAffectedPole.ticket_id == ticket.ticket_id
        )
    )
    affected_poles = [r[0] for r in poles_result.all()]

    return {
        "ticket_id": ticket.ticket_id,
        "display_id": ticket.display_id,
        "status": ticket.status,
        "fault_type": ticket.fault_type,
        "feeder_id": ticket.feeder_id,
        "dt_id": ticket.dt_id,
        "boundary_live_pole": ticket.boundary_live_pole,
        "boundary_dark_pole": ticket.boundary_dark_pole,
        "fault_lat": ticket.fault_lat,
        "fault_lon": ticket.fault_lon,
        "pincode": ticket.pincode,
        "is_range": ticket.is_range,
        "range_description": ticket.range_description,
        "affected_poles": affected_poles,
        "affected_pole_count": ticket.affected_pole_count,
        "estimated_households": ticket.estimated_households,
        "confidence_label": ticket.confidence_label,
        "confidence_factors": ticket.confidence_factors,
        "topology_source": ticket.topology_source,
        "detected_at": ticket.detected_at.isoformat() if ticket.detected_at else None,
        "acknowledged_at": ticket.acknowledged_at.isoformat() if ticket.acknowledged_at else None,
        "crew_assigned_at": ticket.crew_assigned_at.isoformat() if ticket.crew_assigned_at else None,
        "resolved_at": ticket.resolved_at.isoformat() if ticket.resolved_at else None,
        "verified_at": ticket.verified_at.isoformat() if ticket.verified_at else None,
        "closed_at": ticket.closed_at.isoformat() if ticket.closed_at else None,
        "operator_notes": ticket.operator_notes,
    }


@router.post("/{display_id}/transition")
async def transition_ticket(
    display_id: str,
    request: TicketTransitionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Transition a ticket to a new status."""
    from app.main import app_state

    ticket_manager = app_state["ticket_manager"]
    success, message = await ticket_manager.transition_ticket(
        display_id, request.status, db, request.operator_notes
    )

    if not success:
        raise HTTPException(status_code=400, detail=message)

    return {"status": "ok", "message": message}
