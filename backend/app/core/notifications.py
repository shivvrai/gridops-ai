"""
Observer Design Pattern implementation for Grid Event Notifications.

Provides an asynchronous Subject-Observer architecture to decouple grid event producers
(TicketManager, Detection Sweep, Simulator) from downstream consumers
(SSE Browser Stream, Audit Trail Logger, Emergency Crew Alerts, Telemetry Metrics).
"""
import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Dict, Any, Set, List, Union, Callable

logger = logging.getLogger(__name__)


@dataclass
class GridEvent:
    """Strongly-typed domain event representing state changes or anomalies across the grid."""
    event_type: str
    data: Dict[str, Any]
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    priority: str = "MEDIUM"  # LOW, MEDIUM, HIGH, CRITICAL

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.event_type,
            "data": self.data,
            "timestamp": self.timestamp.isoformat(),
            "priority": self.priority,
        }


class EventObserver(ABC):
    """Abstract Base Class for all event observers (GoF Observer interface)."""

    @abstractmethod
    async def notify(self, event: GridEvent) -> None:
        """Handle incoming grid event asynchronously."""
        pass


class NotificationHub:
    """
    Subject / Observable in the Observer Pattern.

    Manages subscriber registries, allows selective event-type filtering,
    concurrently fans out notifications across observers using asyncio.gather,
    and guarantees error-isolation so a failing observer cannot disrupt others.
    """

    def __init__(self):
        # Maps observer instance to set of subscribed event types (or None for all events)
        self._observers: Dict[EventObserver, Optional[Set[str]]] = {}

    def subscribe(
        self,
        observer: EventObserver,
        event_types: Optional[Union[Set[str], List[str]]] = None,
    ) -> None:
        """Attach an observer to the notification hub with optional event-type filtering."""
        if event_types is not None:
            self._observers[observer] = set(event_types)
        else:
            self._observers[observer] = None
        logger.debug(f"Attached observer {observer.__class__.__name__} for events: {self._observers[observer]}")

    def unsubscribe(self, observer: EventObserver) -> None:
        """Detach an observer from the notification hub."""
        if observer in self._observers:
            del self._observers[observer]
            logger.debug(f"Detached observer {observer.__class__.__name__}")

    @property
    def observer_count(self) -> int:
        return len(self._observers)

    def clear(self) -> None:
        """Remove all attached observers."""
        self._observers.clear()

    async def publish(
        self,
        event: Union[GridEvent, str],
        data: Optional[Dict[str, Any]] = None,
        priority: str = "MEDIUM",
    ) -> None:
        """
        Publish an event to all interested observers concurrently.
        Accepts either a GridEvent instance or (event_type, data) arguments.
        """
        if isinstance(event, str):
            grid_event = GridEvent(event_type=event, data=data or {}, priority=priority)
        else:
            grid_event = event

        targets: List[EventObserver] = []
        for obs, filter_types in list(self._observers.items()):
            if filter_types is None or grid_event.event_type in filter_types:
                targets.append(obs)

        if not targets:
            return

        async def _safe_notify(observer: EventObserver):
            try:
                await observer.notify(grid_event)
            except Exception as e:
                logger.error(
                    f"Error in observer {observer.__class__.__name__} handling event '{grid_event.event_type}': {e}",
                    exc_info=True,
                )

        # Concurrently dispatch to all target observers with fault-isolated error boundaries
        await asyncio.gather(*[_safe_notify(t) for t in targets])


# =====================================================================
# Concrete Observers (Decoupled Consumers)
# =====================================================================

class SSEBroadcastObserver(EventObserver):
    """
    Pushes real-time notifications to connected frontend browsers via SSE.
    Decoupled from FastAPI endpoint logic.
    """

    def __init__(self, broadcast_fn: Optional[Callable] = None):
        self.broadcast_fn = broadcast_fn

    async def notify(self, event: GridEvent) -> None:
        if self.broadcast_fn:
            await self.broadcast_fn(event.event_type, event.data)
        else:
            # Lazy import to avoid circular dependencies
            from app.api.events import broadcast_event
            await broadcast_event(event.event_type, event.data)


class CrewAlertObserver(EventObserver):
    """
    Dispatches automated urgent alerts to standby field crews when
    critical/high-priority grid failures (e.g. transformer/feeder outages) occur.
    """

    def __init__(self, min_priority: str = "HIGH"):
        self.min_priority = min_priority
        self.alert_history: List[Dict[str, Any]] = []

    async def notify(self, event: GridEvent) -> None:
        # Check priority threshold
        high_priorities = {"HIGH", "CRITICAL"}
        if self.min_priority == "HIGH" and event.priority not in high_priorities:
            return
        if self.min_priority == "CRITICAL" and event.priority != "CRITICAL":
            return

        display_id = event.data.get("display_id") or event.data.get("ticket_id") or "UNKNOWN"
        fault_type = event.data.get("fault_type", "grid failure")
        dt_id = event.data.get("dt_id", "N/A")
        households = event.data.get("estimated_households", 0)

        alert_message = (
            f"[CRITICAL GRID ALERT] {fault_type.upper()} fault detected on DT {dt_id} "
            f"(Ticket: {display_id}, Affected Households: {households}). "
            f"Automated dispatch alert sent to standby crew lead."
        )

        alert_entry = {
            "timestamp": event.timestamp.isoformat(),
            "priority": event.priority,
            "display_id": display_id,
            "message": alert_message,
            "event_type": event.event_type,
        }

        self.alert_history.append(alert_entry)
        logger.warning(f"CrewAlertObserver dispatched alert: {alert_message}")


class MetricsObserver(EventObserver):
    """
    Tracks telemetry and event metrics in real-time.
    Provides operational observability into event frequencies and latency.
    """

    def __init__(self):
        self.total_events: int = 0
        self.event_counts: Dict[str, int] = {}
        self.priority_counts: Dict[str, int] = {}
        self.last_event_time: Dict[str, datetime] = {}

    async def notify(self, event: GridEvent) -> None:
        self.total_events += 1
        self.event_counts[event.event_type] = self.event_counts.get(event.event_type, 0) + 1
        self.priority_counts[event.priority] = self.priority_counts.get(event.priority, 0) + 1
        self.last_event_time[event.event_type] = event.timestamp

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total_events": self.total_events,
            "event_counts": dict(self.event_counts),
            "priority_counts": dict(self.priority_counts),
            "last_event_times": {k: v.isoformat() for k, v in self.last_event_time.items()},
        }


class AuditLogObserver(EventObserver):
    """
    Persists immutable audit log records for regulatory compliance
    when state-changing ticket transitions occur.
    """

    def __init__(self, session_factory=None):
        self.session_factory = session_factory

    async def notify(self, event: GridEvent) -> None:
        # Only log significant lifecycle and state transition events
        auditable_events = {"ticket_created", "ticket_updated", "ticket_verified", "device_anomaly"}
        if event.event_type not in auditable_events:
            return

        if not self.session_factory:
            from app.models.database import async_session
            session_factory = async_session
        else:
            session_factory = self.session_factory

        from app.core.auth import record_audit_log
        display_id = event.data.get("display_id")

        try:
            async with session_factory() as db:
                await record_audit_log(
                    db=db,
                    action=f"EVENT_{event.event_type.upper()}",
                    entity_type="ticket" if "ticket" in event.event_type else "device",
                    entity_id=str(display_id) if display_id else None,
                    details=event.data,
                    user=None,  # System event
                    ip_address="internal.notification.hub",
                )
        except Exception as e:
            logger.error(f"AuditLogObserver failed to record audit log: {e}", exc_info=True)
