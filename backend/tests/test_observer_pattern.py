"""
Tests for Observer Design Pattern in Grid Event Notification System.

Verifies:
1. Subject-Observer contract (attach, detach, observer count)
2. Selective event-type filtering
3. Fault-isolated error boundaries (one failing observer does not break others)
4. Concrete observers (SSEBroadcastObserver, CrewAlertObserver, MetricsObserver)
5. TicketManager integration and backward compatibility
"""
import pytest
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.core.notifications import (
    GridEvent,
    EventObserver,
    NotificationHub,
    SSEBroadcastObserver,
    CrewAlertObserver,
    MetricsObserver,
)
from app.core.localization import LocalizationEngine, FaultBoundary
from app.core.ticket_manager import TicketManager


class DummyTrackingObserver(EventObserver):
    """Helper observer that records all received events."""
    def __init__(self):
        self.received_events: list[GridEvent] = []

    async def notify(self, event: GridEvent) -> None:
        self.received_events.append(event)


class FailingObserver(EventObserver):
    """Observer that raises an error to test fault isolation."""
    async def notify(self, event: GridEvent) -> None:
        raise RuntimeError("Simulated network failure in observer")


class TestNotificationHubBasics:
    @pytest.mark.asyncio
    async def test_subscribe_and_unsubscribe(self):
        hub = NotificationHub()
        obs1 = DummyTrackingObserver()
        obs2 = DummyTrackingObserver()

        assert hub.observer_count == 0
        hub.subscribe(obs1)
        hub.subscribe(obs2)
        assert hub.observer_count == 2

        event = GridEvent(event_type="test_event", data={"foo": "bar"})
        await hub.publish(event)

        assert len(obs1.received_events) == 1
        assert len(obs2.received_events) == 1
        assert obs1.received_events[0].data == {"foo": "bar"}

        # Unsubscribe
        hub.unsubscribe(obs1)
        assert hub.observer_count == 1

        await hub.publish("another_event", {"key": 123})
        assert len(obs1.received_events) == 1  # Did not receive second event
        assert len(obs2.received_events) == 2  # Received second event

        # Clear
        hub.clear()
        assert hub.observer_count == 0


class TestEventTypeFiltering:
    @pytest.mark.asyncio
    async def test_selective_event_filtering(self):
        hub = NotificationHub()
        ticket_obs = DummyTrackingObserver()
        anomaly_obs = DummyTrackingObserver()
        global_obs = DummyTrackingObserver()

        # Subscribe with filters
        hub.subscribe(ticket_obs, event_types={"ticket_created", "ticket_verified"})
        hub.subscribe(anomaly_obs, event_types={"device_anomaly"})
        hub.subscribe(global_obs)  # None = all events

        # Publish ticket event
        await hub.publish(GridEvent(event_type="ticket_created", data={"id": 1}))
        # Publish anomaly event
        await hub.publish(GridEvent(event_type="device_anomaly", data={"pole": "P-01"}))
        # Publish unrelated event
        await hub.publish(GridEvent(event_type="crew_ping", data={}))

        assert len(ticket_obs.received_events) == 1
        assert ticket_obs.received_events[0].event_type == "ticket_created"

        assert len(anomaly_obs.received_events) == 1
        assert anomaly_obs.received_events[0].event_type == "device_anomaly"

        assert len(global_obs.received_events) == 3


class TestFaultIsolatedErrorBoundaries:
    @pytest.mark.asyncio
    async def test_failing_observer_does_not_break_others(self):
        hub = NotificationHub()
        failing_obs = FailingObserver()
        healthy_obs = DummyTrackingObserver()

        hub.subscribe(failing_obs)
        hub.subscribe(healthy_obs)

        # Publishing should NOT raise an exception
        await hub.publish(GridEvent(event_type="ticket_created", data={"status": "new"}))

        # Healthy observer still successfully received the event
        assert len(healthy_obs.received_events) == 1
        assert healthy_obs.received_events[0].data["status"] == "new"


class TestConcreteObservers:
    @pytest.mark.asyncio
    async def test_sse_broadcast_observer(self):
        mock_broadcast = AsyncMock()
        observer = SSEBroadcastObserver(broadcast_fn=mock_broadcast)

        event = GridEvent(
            event_type="ticket_created",
            data={"display_id": "FLT-2026-001"},
            priority="HIGH",
        )
        await observer.notify(event)

        mock_broadcast.assert_awaited_once_with("ticket_created", {"display_id": "FLT-2026-001"})

    @pytest.mark.asyncio
    async def test_crew_alert_observer_threshold(self):
        crew_obs = CrewAlertObserver(min_priority="HIGH")

        # Low priority event - should NOT trigger alert
        low_event = GridEvent(
            event_type="ticket_created",
            data={"display_id": "FLT-LOW-01", "fault_type": "span", "dt_id": "D-01"},
            priority="LOW",
        )
        await crew_obs.notify(low_event)
        assert len(crew_obs.alert_history) == 0

        # Critical event - SHOULD trigger alert
        crit_event = GridEvent(
            event_type="ticket_created",
            data={"display_id": "FLT-CRIT-01", "fault_type": "transformer", "dt_id": "D-02", "estimated_households": 250},
            priority="CRITICAL",
        )
        await crew_obs.notify(crit_event)
        assert len(crew_obs.alert_history) == 1
        assert "CRITICAL GRID ALERT" in crew_obs.alert_history[0]["message"]
        assert crew_obs.alert_history[0]["display_id"] == "FLT-CRIT-01"

    @pytest.mark.asyncio
    async def test_metrics_observer_tracking(self):
        metrics_obs = MetricsObserver()

        await metrics_obs.notify(GridEvent(event_type="ticket_created", data={}, priority="HIGH"))
        await metrics_obs.notify(GridEvent(event_type="ticket_created", data={}, priority="MEDIUM"))
        await metrics_obs.notify(GridEvent(event_type="device_anomaly", data={}, priority="LOW"))

        stats = metrics_obs.get_stats()
        assert stats["total_events"] == 3
        assert stats["event_counts"]["ticket_created"] == 2
        assert stats["event_counts"]["device_anomaly"] == 1
        assert stats["priority_counts"]["HIGH"] == 1
        assert stats["priority_counts"]["MEDIUM"] == 1
        assert stats["priority_counts"]["LOW"] == 1
        assert "ticket_created" in stats["last_event_times"]


class TestTicketManagerObserverIntegration:
    @pytest.mark.asyncio
    async def test_ticket_manager_publishes_to_observers(self):
        hub = NotificationHub()
        tracking_obs = DummyTrackingObserver()
        crew_obs = CrewAlertObserver(min_priority="HIGH")

        hub.subscribe(tracking_obs)
        hub.subscribe(crew_obs)

        engine = LocalizationEngine()
        tm = TicketManager(engine, publisher=hub)

        boundary = FaultBoundary(
            boundary_live_pole="P-01",
            boundary_dark_pole="P-02",
            dt_id="D-01",
            feeder_id="F-01",
            fault_type="span",
            affected_poles=["P-02"],
            topology_source="surveyed",
            topology_confidence="HIGH",
            detected_at=datetime.now(timezone.utc),
            span_distance_m=45.0,
            total_dark_line_length_m=45.0,
            dt_distance_m=45.0,
        )

        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        # Create ticket
        ticket_data = await tm.create_ticket_from_boundary(boundary, mock_db)
        assert ticket_data is not None

        # Verify observers received event
        assert len(tracking_obs.received_events) == 1
        created_event = tracking_obs.received_events[0]
        assert created_event.event_type == "ticket_created"
        assert created_event.data["display_id"] == ticket_data["display_id"]

    @pytest.mark.asyncio
    async def test_backward_compatibility_on_ticket_event_callback(self):
        engine = LocalizationEngine()
        tm = TicketManager(engine)

        legacy_calls = []
        async def legacy_callback(event_type, data):
            legacy_calls.append((event_type, data))

        # Wire legacy single callback
        tm.on_ticket_event = legacy_callback

        boundary = FaultBoundary(
            boundary_live_pole="P-01",
            boundary_dark_pole="P-02",
            dt_id="D-01",
            feeder_id="F-01",
            fault_type="span",
            affected_poles=["P-02"],
            topology_source="surveyed",
            topology_confidence="HIGH",
            detected_at=datetime.now(timezone.utc),
        )

        mock_db = AsyncMock()
        mock_db.add = MagicMock()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db.execute.return_value = mock_result

        await tm.create_ticket_from_boundary(boundary, mock_db)

        # Legacy callback was invoked without breaking
        assert len(legacy_calls) == 1
        assert legacy_calls[0][0] == "ticket_created"
