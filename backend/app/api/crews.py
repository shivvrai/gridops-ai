"""Crew management and Field Crew incident operations API."""
import logging
from datetime import datetime, timezone
from typing import Optional, List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import get_db
from app.models.schemas import Crew, Ticket, TicketAffectedPole, TicketTransitionHistory, User
from app.core.auth import get_current_user, require_roles, record_audit_log

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/crews", tags=["crews"])


class CreateCrewRequest(BaseModel):
    crew_id: str  # e.g., "CREW-01"
    name: str     # e.g., "North Line Maintenance Alpha"
    lead_name: str
    contact: str
    base_station: Optional[str] = "Main Substation Yard"


class UpdateCrewRequest(BaseModel):
    name: Optional[str] = None
    lead_name: Optional[str] = None
    contact: Optional[str] = None
    status: Optional[str] = None  # available, dispatched, off_duty
    base_station: Optional[str] = None


class AssignCrewRequest(BaseModel):
    ticket_display_id: str
    crew_id: str
    notes: Optional[str] = None


class FieldCrewStatusUpdateRequest(BaseModel):
    stage: str  # "arrived", "repair_started", "repair_completed"
    field_notes: Optional[str] = None


@router.get("/")
@router.get("")
async def list_crews(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all repair crews with operational status."""
    result = await db.execute(select(Crew).order_by(Crew.crew_id))
    crews = result.scalars().all()
    return [
        {
            "crew_id": c.crew_id,
            "name": c.name,
            "lead_name": c.lead_name,
            "contact": c.contact,
            "status": c.status,
            "base_station": c.base_station,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in crews
    ]


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_crew(
    req: CreateCrewRequest,
    admin: User = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only: register a new field maintenance crew."""
    existing = await db.get(Crew, req.crew_id)
    if existing:
        raise HTTPException(status_code=400, detail=f"Crew {req.crew_id} already exists")

    crew = Crew(
        crew_id=req.crew_id.strip().upper(),
        name=req.name.strip(),
        lead_name=req.lead_name.strip(),
        contact=req.contact.strip(),
        base_station=req.base_station,
        status="available",
    )
    db.add(crew)
    await db.commit()

    await record_audit_log(
        db, action="CREW_CREATED",
        entity_type="crew", entity_id=crew.crew_id,
        details={"name": crew.name, "lead": crew.lead_name},
        user=admin,
    )

    return {
        "status": "created",
        "crew_id": crew.crew_id,
        "name": crew.name,
        "status": crew.status,
    }


@router.patch("/{crew_id}")
async def update_crew(
    crew_id: str,
    req: UpdateCrewRequest,
    admin: User = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only: update crew contact, status, or lead."""
    crew = await db.get(Crew, crew_id)
    if not crew:
        raise HTTPException(status_code=404, detail="Crew not found")

    if req.name is not None:
        crew.name = req.name.strip()
    if req.lead_name is not None:
        crew.lead_name = req.lead_name.strip()
    if req.contact is not None:
        crew.contact = req.contact.strip()
    if req.status is not None:
        valid_statuses = ("available", "dispatched", "off_duty")
        if req.status.lower() not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Status must be one of: {', '.join(valid_statuses)}")
        crew.status = req.status.lower()
    if req.base_station is not None:
        crew.base_station = req.base_station.strip()

    await db.commit()

    await record_audit_log(
        db, action="CREW_UPDATED",
        entity_type="crew", entity_id=crew.crew_id,
        details={"status": crew.status},
        user=admin,
    )

    return {"status": "updated", "crew_id": crew.crew_id, "crew_status": crew.status}


@router.post("/assign")
async def assign_crew_to_ticket(
    req: AssignCrewRequest,
    user: User = Depends(require_roles(["ADMIN", "OPERATOR"])),
    db: AsyncSession = Depends(get_db),
):
    """Assign a field crew to an incident ticket and transition state."""
    ticket_result = await db.execute(select(Ticket).where(Ticket.display_id == req.ticket_display_id))
    ticket = ticket_result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket {req.ticket_display_id} not found")

    crew = await db.get(Crew, req.crew_id)
    if not crew:
        raise HTTPException(status_code=404, detail=f"Crew {req.crew_id} not found")

    from_status = ticket.status
    ticket.assigned_crew_id = crew.crew_id
    ticket.crew_assigned_at = datetime.now(timezone.utc)
    if ticket.status in ("detected", "acknowledged"):
        ticket.status = "crew_assigned"

    if req.notes:
        note_line = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] Assigned to {crew.name} ({crew.crew_id}): {req.notes}"
        ticket.operator_notes = f"{ticket.operator_notes}\n{note_line}" if ticket.operator_notes else note_line

    crew.status = "dispatched"

    # Record transition history
    history = TicketTransitionHistory(
        ticket_id=ticket.ticket_id,
        display_id=ticket.display_id,
        from_status=from_status,
        to_status=ticket.status,
        user_id=user.user_id,
        user_name=user.name,
        notes=f"Assigned to {crew.name} ({crew.crew_id}). {req.notes or ''}".strip(),
    )
    db.add(history)
    await db.commit()

    # Broadcast SSE update
    from app.api.events import broadcast_event
    await broadcast_event("ticket_updated", {
        "display_id": ticket.display_id,
        "status": ticket.status,
        "assigned_crew_id": crew.crew_id,
    })

    await record_audit_log(
        db, action="CREW_ASSIGNED",
        entity_type="ticket", entity_id=ticket.display_id,
        details={"crew_id": crew.crew_id, "crew_name": crew.name},
        user=user,
    )

    return {
        "status": "assigned",
        "ticket_display_id": ticket.display_id,
        "assigned_crew": crew.name,
        "ticket_status": ticket.status,
    }


@router.get("/my-incidents")
async def get_my_incidents(
    crew_id: Optional[str] = None,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Field Crew: retrieve assigned active and recent incidents."""
    query = select(Ticket).order_by(Ticket.detected_at.desc())

    if crew_id:
        query = query.where(Ticket.assigned_crew_id == crew_id)
    elif user.role == "FIELD_CREW":
        # If user is field crew, match by their linked crew_id or assigned tickets
        # If no specific crew assigned, show all tickets with assigned crews
        query = query.where(Ticket.assigned_crew_id.isnot(None))

    result = await db.execute(query)
    tickets = result.scalars().all()

    items = []
    for t in tickets:
        poles_res = await db.execute(
            select(TicketAffectedPole.pole_id).where(TicketAffectedPole.ticket_id == t.ticket_id)
        )
        affected = [r[0] for r in poles_res.all()]
        crew = await db.get(Crew, t.assigned_crew_id) if t.assigned_crew_id else None

        items.append({
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
            "priority_score": t.priority_score,
            "affected_poles": affected,
            "affected_pole_count": t.affected_pole_count,
            "confidence_label": t.confidence_label,
            "assigned_crew_id": t.assigned_crew_id,
            "assigned_crew_name": crew.name if crew else None,
            "field_notes": t.field_notes,
            "operator_notes": t.operator_notes,
            "detected_at": t.detected_at.isoformat() if t.detected_at else None,
            "crew_assigned_at": t.crew_assigned_at.isoformat() if t.crew_assigned_at else None,
            "resolved_at": t.resolved_at.isoformat() if t.resolved_at else None,
        })

    return items


@router.post("/incidents/{display_id}/status")
async def update_incident_field_status(
    display_id: str,
    req: FieldCrewStatusUpdateRequest,
    user: User = Depends(require_roles(["FIELD_CREW", "ADMIN", "OPERATOR"])),
    db: AsyncSession = Depends(get_db),
):
    """Field Crew: report progress (Arrived, Repair Started, Repair Completed)."""
    valid_stages = ("arrived", "repair_started", "repair_completed")
    if req.stage.lower() not in valid_stages:
        raise HTTPException(status_code=400, detail=f"Stage must be one of: {', '.join(valid_stages)}")

    ticket_result = await db.execute(select(Ticket).where(Ticket.display_id == display_id))
    ticket = ticket_result.scalar_one_or_none()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket {display_id} not found")

    from_status = ticket.status
    now_str = datetime.now(timezone.utc).strftime("%H:%M:%S")

    # Update field notes
    stage_label = req.stage.replace("_", " ").title()
    entry = f"[{now_str}] {user.name} ({stage_label}): {req.field_notes or 'Status update recorded'}"
    ticket.field_notes = f"{ticket.field_notes}\n{entry}" if ticket.field_notes else entry

    if req.stage == "repair_completed":
        ticket.status = "resolved"
        ticket.resolved_at = datetime.now(timezone.utc)
        # Free up the assigned crew
        if ticket.assigned_crew_id:
            crew = await db.get(Crew, ticket.assigned_crew_id)
            if crew:
                crew.status = "available"

    # Record transition history
    history = TicketTransitionHistory(
        ticket_id=ticket.ticket_id,
        display_id=ticket.display_id,
        from_status=from_status,
        to_status=ticket.status,
        user_id=user.user_id,
        user_name=user.name,
        notes=f"Field update: {stage_label}. {req.field_notes or ''}".strip(),
    )
    db.add(history)
    await db.commit()

    # Broadcast update
    from app.api.events import broadcast_event
    await broadcast_event("ticket_updated", {
        "display_id": ticket.display_id,
        "status": ticket.status,
        "field_notes": ticket.field_notes,
    })

    await record_audit_log(
        db, action="FIELD_STATUS_UPDATE",
        entity_type="ticket", entity_id=ticket.display_id,
        details={"stage": req.stage, "user": user.name},
        user=user,
    )

    return {
        "status": "updated",
        "ticket_display_id": ticket.display_id,
        "current_status": ticket.status,
        "stage": req.stage,
    }
