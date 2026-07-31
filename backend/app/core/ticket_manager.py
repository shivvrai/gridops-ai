"""
Ticket state machine and manager.

Handles ticket lifecycle:
  detected → acknowledged → crew_assigned → resolved → verified → closed

Key constraints:
- resolved requires all affected poles to be live (rejection of premature resolve)
- verified is system-only (triggered by telemetry confirmation)
- After restoration, re-runs localization for cascaded fault detection
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, and_

from app.models.schemas import Ticket, TicketAffectedPole, Pole
from app.core.localization import FaultBoundary, LocalizationEngine

logger = logging.getLogger(__name__)

# Valid state transitions
VALID_TRANSITIONS = {
    "detected": ["acknowledged"],
    "acknowledged": ["crew_assigned"],
    "crew_assigned": ["resolved"],
    "resolved": ["verified"],  # system-only
    "verified": ["closed"],
    "closed": [],
}

# States that allow auto-verification (system detects all poles live)
AUTO_VERIFY_STATES = {"detected", "acknowledged", "crew_assigned", "resolved"}


class TicketManager:
    """Manages fault ticket lifecycle."""

    def __init__(self, engine: LocalizationEngine):
        self.engine = engine
        # Active tickets by display_id for quick lookup
        self.active_tickets: dict[str, dict] = {}
        # Mapping: pole_id → set of display_ids affecting it
        self.pole_to_tickets: dict[str, set[str]] = {}
        # SSE event callback (set by the app)
        self.on_ticket_event: Optional[callable] = None

    async def create_ticket_from_boundary(
        self, boundary: FaultBoundary, db: AsyncSession
    ) -> Optional[dict]:
        """Create a new ticket from a detected fault boundary."""
        # Compute confidence
        confidence_label, confidence_factors = self.engine.compute_confidence(boundary)

        # Compute fault location (midpoint of boundary span)
        fault_lat, fault_lon, pincode = self._compute_location(boundary)

        display_id = self.engine.next_display_id()

        # Estimate affected households
        estimated_households = self._estimate_households(boundary)

        ticket = Ticket(
            display_id=display_id,
            status="detected",
            fault_type=boundary.fault_type,
            feeder_id=boundary.feeder_id,
            dt_id=boundary.dt_id,
            boundary_live_pole=boundary.boundary_live_pole,
            boundary_dark_pole=boundary.boundary_dark_pole,
            fault_lat=fault_lat,
            fault_lon=fault_lon,
            pincode=pincode,
            is_range=boundary.is_range,
            range_description=boundary.range_description,
            affected_pole_count=len(boundary.affected_poles),
            estimated_households=estimated_households,
            confidence_label=confidence_label,
            confidence_factors=confidence_factors,
            topology_source=boundary.topology_source,
            detected_at=boundary.detected_at,
        )

        db.add(ticket)
        await db.flush()

        # Add affected poles
        for pole_id in boundary.affected_poles:
            db.add(TicketAffectedPole(ticket_id=ticket.ticket_id, pole_id=pole_id))
            self.pole_to_tickets.setdefault(pole_id, set()).add(display_id)

        await db.commit()

        ticket_data = self._ticket_to_dict(ticket, boundary.affected_poles)
        self.active_tickets[display_id] = ticket_data

        logger.info(f"Created ticket {display_id}: {boundary.fault_type} fault on "
                    f"{'feeder ' + boundary.feeder_id if boundary.fault_type == 'feeder' else 'DT ' + str(boundary.dt_id)}, "
                    f"confidence={confidence_label}, affected={len(boundary.affected_poles)} poles")

        # Notify SSE listeners
        if self.on_ticket_event:
            await self.on_ticket_event("ticket_created", ticket_data)

        return ticket_data

    async def transition_ticket(
        self, display_id: str, new_status: str, db: AsyncSession,
        operator_notes: Optional[str] = None
    ) -> tuple[bool, str]:
        """
        Attempt a state transition on a ticket.
        Returns (success, message).
        """
        result = await db.execute(
            select(Ticket).where(Ticket.display_id == display_id)
        )
        ticket = result.scalar_one_or_none()
        if not ticket:
            return False, f"Ticket {display_id} not found"

        current = ticket.status
        if new_status not in VALID_TRANSITIONS.get(current, []):
            return False, (f"Cannot transition from '{current}' to '{new_status}'. "
                          f"Valid transitions: {VALID_TRANSITIONS.get(current, [])}")

        # Special check: resolved requires all poles to be live
        if new_status == "resolved":
            dark_poles = await self._count_dark_affected_poles(ticket.ticket_id, db)
            if dark_poles > 0:
                return False, (f"Cannot verify resolution: {dark_poles} pole(s) still dark. "
                              f"The system requires telemetry confirmation that all affected "
                              f"poles are energized before a ticket can be resolved.")

        now = datetime.now(timezone.utc)
        ticket.status = new_status
        if operator_notes:
            ticket.operator_notes = operator_notes

        # Set timestamp for the new status
        timestamp_fields = {
            "acknowledged": "acknowledged_at",
            "crew_assigned": "crew_assigned_at",
            "resolved": "resolved_at",
            "verified": "verified_at",
            "closed": "closed_at",
        }
        if new_status in timestamp_fields:
            setattr(ticket, timestamp_fields[new_status], now)

        await db.commit()

        # Update active cache
        if display_id in self.active_tickets:
            self.active_tickets[display_id]["status"] = new_status
            self.active_tickets[display_id][timestamp_fields.get(new_status, "")] = now.isoformat() if now else None

        if new_status in ("verified", "closed"):
            # Clean up pole-to-ticket mappings
            self._cleanup_ticket(display_id)

        # Notify SSE
        if self.on_ticket_event:
            await self.on_ticket_event("ticket_updated", {
                "display_id": display_id,
                "status": new_status,
                "timestamp": now.isoformat(),
            })

        logger.info(f"Ticket {display_id}: {current} → {new_status}")
        return True, f"Ticket {display_id} transitioned to '{new_status}'"

    async def check_restoration(self, db: AsyncSession) -> list[str]:
        """
        Check all active tickets for restoration.
        Auto-verify tickets where all affected poles are back to live.
        Returns list of display_ids that were auto-verified.
        """
        verified = []

        for display_id, ticket_data in list(self.active_tickets.items()):
            if ticket_data["status"] not in AUTO_VERIFY_STATES:
                continue

            ticket_id = ticket_data.get("ticket_id")
            if not ticket_id:
                continue

            dark_poles = await self._count_dark_affected_poles(ticket_id, db)
            if dark_poles == 0:
                # All poles are live — auto-verify
                result = await db.execute(
                    select(Ticket).where(Ticket.ticket_id == ticket_id)
                )
                ticket = result.scalar_one_or_none()
                if ticket and ticket.status in AUTO_VERIFY_STATES:
                    now = datetime.now(timezone.utc)
                    ticket.status = "verified"
                    ticket.verified_at = now
                    await db.commit()

                    self.active_tickets[display_id]["status"] = "verified"
                    verified.append(display_id)
                    self._cleanup_ticket(display_id)

                    logger.info(f"Ticket {display_id} auto-verified: all {ticket.affected_pole_count} poles restored")

                    if self.on_ticket_event:
                        await self.on_ticket_event("ticket_verified", {
                            "display_id": display_id,
                            "status": "verified",
                            "timestamp": now.isoformat(),
                        })

        return verified

    async def _count_dark_affected_poles(self, ticket_id: int, db: AsyncSession) -> int:
        """Count how many affected poles are still dark for a ticket."""
        result = await db.execute(
            select(TicketAffectedPole.pole_id).where(
                TicketAffectedPole.ticket_id == ticket_id
            )
        )
        affected_pole_ids = [row[0] for row in result.all()]

        dark_count = 0
        for pole_id in affected_pole_ids:
            state = self.engine.pole_states.get(pole_id)
            if state and state.status in ("confirmed_dark", "suspected_dark"):
                dark_count += 1
        return dark_count

    def _compute_location(self, boundary: FaultBoundary) -> tuple[Optional[float], Optional[float], Optional[str]]:
        """Compute fault GPS location and pincode from boundary poles."""
        lat, lon, pincode = None, None, None

        if boundary.boundary_live_pole and boundary.boundary_dark_pole:
            live_state = self.engine.pole_states.get(boundary.boundary_live_pole)
            dark_state = self.engine.pole_states.get(boundary.boundary_dark_pole)

            if self.engine.network_graph:
                live_data = self.engine.network_graph.nodes.get(boundary.boundary_live_pole, {})
                dark_data = self.engine.network_graph.nodes.get(boundary.boundary_dark_pole, {})

                live_lat = live_data.get("lat")
                live_lon = live_data.get("lon")
                dark_lat = dark_data.get("lat")
                dark_lon = dark_data.get("lon")

                if all(v is not None for v in (live_lat, live_lon, dark_lat, dark_lon)):
                    lat = (live_lat + dark_lat) / 2
                    lon = (live_lon + dark_lon) / 2

                pincode = dark_data.get("pincode") or live_data.get("pincode")
        elif boundary.dt_id and self.engine.network_graph:
            dt_data = self.engine.network_graph.nodes.get(boundary.dt_id, {})
            lat = dt_data.get("lat")
            lon = dt_data.get("lon")
            # Get pincode from any pole on this DT
            for pole_id in boundary.affected_poles[:1]:
                pole_data = self.engine.network_graph.nodes.get(pole_id, {})
                pincode = pole_data.get("pincode")
                if pincode:
                    break

        return lat, lon, pincode

    def _estimate_households(self, boundary: FaultBoundary) -> int:
        """Rough estimate of affected households from DT data."""
        if boundary.dt_id and self.engine.network_graph:
            dt_data = self.engine.network_graph.nodes.get(boundary.dt_id, {})
            total_households = dt_data.get("households_served", 0)
            # Count total poles on this DT
            dt_poles = [n for n in self.engine.network_graph.successors(boundary.dt_id)
                       if self.engine.network_graph.nodes[n].get("node_type") == "pole"]
            total_poles = len(dt_poles) if dt_poles else 1
            # Proportional estimate
            affected_ratio = len(boundary.affected_poles) / max(total_poles, 1)
            return int(total_households * affected_ratio)
        return 0

    def _cleanup_ticket(self, display_id: str):
        """Remove pole-to-ticket mappings for a closed/verified ticket."""
        ticket_data = self.active_tickets.get(display_id)
        if ticket_data:
            for pole_id in ticket_data.get("affected_poles", []):
                tickets = self.pole_to_tickets.get(pole_id, set())
                tickets.discard(display_id)

    def _ticket_to_dict(self, ticket: Ticket, affected_poles: list[str]) -> dict:
        """Convert a Ticket ORM object to a dict for caching and API responses."""
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

    async def is_duplicate_boundary(self, boundary: FaultBoundary) -> bool:
        """Check if a fault boundary already has an active ticket."""
        for display_id, ticket_data in self.active_tickets.items():
            if ticket_data["status"] in ("verified", "closed"):
                continue
            # Same DT + same boundary poles = duplicate
            if (ticket_data["dt_id"] == boundary.dt_id and
                ticket_data["boundary_live_pole"] == boundary.boundary_live_pole and
                ticket_data["boundary_dark_pole"] == boundary.boundary_dark_pole):
                return True
            # Same DT + same fault type for DT/feeder level
            if (boundary.fault_type in ("dt", "feeder") and
                ticket_data["fault_type"] == boundary.fault_type and
                ticket_data.get("dt_id") == boundary.dt_id):
                return True
        return False
