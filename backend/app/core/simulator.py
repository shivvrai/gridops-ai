"""
Fault simulator for testing and demo.

Generates realistic telemetry events that mimic real-world fault scenarios:
- Span faults (wire break between two poles)
- DT-level faults (transformer failure)
- Feeder-level faults (11kV line failure)
- Device death (sensor failure with power fine)
- Scheduled outages

Includes realistic noise: 30% missed dying messages, fw1.2 silent devices,
duplicates, out-of-order timestamps, clock skew.
"""
import random
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
import networkx as nx

from app.core.localization import LocalizationEngine

logger = logging.getLogger(__name__)


class FaultSimulator:
    """Generates realistic telemetry events for fault scenarios."""

    def __init__(self, engine: LocalizationEngine):
        self.engine = engine
        self.rng = random.Random(12345)
        self._seq_counters: dict[str, int] = {}  # device_id → next seq

    def _next_seq(self, device_id: str) -> int:
        """Get next sequence number for a device."""
        seq = self._seq_counters.get(device_id, 1000)
        self._seq_counters[device_id] = seq + 1
        return seq

    def _make_event(
        self, pole_id: str, device_id: str, event: str,
        energized: bool, fw: str, ts: Optional[datetime] = None,
        battery_mv: int = 3600, rssi: int = -85
    ) -> dict:
        """Create a telemetry event payload."""
        if ts is None:
            ts = datetime.now(timezone.utc)
        # Add clock skew ±90s
        skew = timedelta(seconds=self.rng.uniform(-90, 90))
        device_ts = ts + skew

        return {
            "device_id": device_id,
            "pole_id": pole_id,
            "event": event,
            "energized": energized,
            "ts": device_ts.isoformat(),
            "seq": self._next_seq(device_id),
            "battery_mv": battery_mv,
            "rssi": rssi + self.rng.randint(-10, 5),
            "fw": fw,
        }

    def inject_span_fault(
        self, dt_id: str, fault_after_pole: Optional[str] = None,
        message_loss_rate: float = 0.30, include_duplicates: bool = True,
    ) -> list[dict]:
        """
        Simulate a span fault on a DT's line.
        
        If fault_after_pole is given, the fault is between that pole and its
        first child. Otherwise, picks a random mid-line pole.
        
        Returns list of telemetry events to ingest.
        """
        if dt_id not in self.engine.dt_trees:
            logger.error(f"DT {dt_id} not found in network")
            return []

        tree = self.engine.dt_trees[dt_id]

        # Find all poles on this DT
        poles = [n for n in tree.nodes
                if tree.nodes[n].get("node_type") == "pole"]
        if not poles:
            return []

        # Pick fault location
        if fault_after_pole and fault_after_pole in tree.nodes:
            live_pole = fault_after_pole
        else:
            # Pick a pole that has children (so there's a downstream)
            poles_with_children = [p for p in poles if list(tree.successors(p))]
            if not poles_with_children:
                live_pole = poles[len(poles) // 3]  # fallback
            else:
                live_pole = self.rng.choice(poles_with_children)

        # Collect all downstream (dark) poles
        dark_poles = self._collect_subtree(live_pole, tree)
        # Remove the live_pole itself from dark set
        dark_poles = [p for p in dark_poles if p != live_pole]

        if not dark_poles:
            # No downstream poles, pick differently
            if len(poles) > 2:
                idx = len(poles) // 2
                live_pole = poles[idx - 1] if idx > 0 else poles[0]
                dark_poles = poles[idx:]
            else:
                dark_poles = poles[1:]

        logger.info(f"Simulating span fault on DT {dt_id}: "
                    f"live_pole={live_pole}, dark_poles={len(dark_poles)}")

        events = []
        now = datetime.now(timezone.utc)

        for pole_id in dark_poles:
            node_data = tree.nodes.get(pole_id, {})
            device_id = node_data.get("device_id")
            fw = node_data.get("fw_version", "1.4.2")

            if not device_id:
                continue  # No device — silent

            # fw 1.2 devices don't send power_lost
            if fw and fw.startswith("1.2"):
                logger.debug(f"Pole {pole_id} (fw {fw}): silent on power loss")
                continue

            # 30% message loss
            if self.rng.random() < message_loss_rate:
                logger.debug(f"Pole {pole_id}: dying message lost")
                continue

            # Generate power_lost event
            evt = self._make_event(
                pole_id=pole_id,
                device_id=device_id,
                event="power_lost",
                energized=False,
                fw=fw,
                ts=now,
                battery_mv=self.rng.randint(3100, 3500),
            )
            events.append(evt)

            # ~10% chance of duplicate
            if include_duplicates and self.rng.random() < 0.10:
                dup = evt.copy()
                dup["seq"] = evt["seq"]  # same seq = duplicate
                events.append(dup)

        # Shuffle to simulate out-of-order arrival
        self.rng.shuffle(events)

        return events

    def inject_dt_fault(self, dt_id: str, message_loss_rate: float = 0.30) -> list[dict]:
        """Simulate a DT-level fault (transformer failure). All poles go dark."""
        if dt_id not in self.engine.dt_trees:
            return []

        tree = self.engine.dt_trees[dt_id]
        poles = [n for n in tree.nodes if tree.nodes[n].get("node_type") == "pole"]

        logger.info(f"Simulating DT fault on {dt_id}: {len(poles)} poles affected")

        events = []
        now = datetime.now(timezone.utc)

        for pole_id in poles:
            node_data = tree.nodes.get(pole_id, {})
            device_id = node_data.get("device_id")
            fw = node_data.get("fw_version", "1.4.2")

            if not device_id:
                continue
            if fw and fw.startswith("1.2"):
                continue
            if self.rng.random() < message_loss_rate:
                continue

            evt = self._make_event(
                pole_id=pole_id, device_id=device_id,
                event="power_lost", energized=False, fw=fw, ts=now,
                battery_mv=self.rng.randint(3100, 3500),
            )
            events.append(evt)

        self.rng.shuffle(events)
        return events

    def inject_feeder_fault(self, feeder_id: str, message_loss_rate: float = 0.30) -> list[dict]:
        """Simulate a feeder-level fault. All DTs on the feeder go dark."""
        if not self.engine.network_graph:
            return []

        dt_ids = [n for n in self.engine.network_graph.successors(feeder_id)
                  if self.engine.network_graph.nodes[n].get("node_type") == "dt"]

        logger.info(f"Simulating feeder fault on {feeder_id}: {len(dt_ids)} DTs affected")

        events = []
        for dt_id in dt_ids:
            events.extend(self.inject_dt_fault(dt_id, message_loss_rate))

        self.rng.shuffle(events)
        return events

    def inject_device_death(self, pole_id: str) -> list[dict]:
        """
        Simulate a device dying while power is fine.
        The device stops sending heartbeats but the pole is actually energized.
        This should NOT create a fault ticket.
        """
        if not self.engine.network_graph:
            return []

        node_data = self.engine.network_graph.nodes.get(pole_id, {})
        device_id = node_data.get("device_id")
        if not device_id:
            return []

        logger.info(f"Simulating device death on pole {pole_id}")

        # Mark the device as dead in state
        state = self.engine.pole_states.get(pole_id)
        if state:
            state.device_healthy = False
            state.status = "unknown"

        return []  # No events generated — the device is simply silent

    def repair_fault(self, dt_id: str, affected_poles: Optional[list[str]] = None) -> list[dict]:
        """
        Simulate fault repair. Affected poles send boot + power_restored.
        """
        if dt_id not in self.engine.dt_trees:
            return []

        tree = self.engine.dt_trees[dt_id]

        if affected_poles is None:
            # Repair all dark poles on this DT
            affected_poles = [
                n for n in tree.nodes
                if tree.nodes[n].get("node_type") == "pole"
                and self.engine.pole_states.get(n, None)
                and self.engine.pole_states[n].status in ("confirmed_dark", "suspected_dark")
            ]

        logger.info(f"Simulating repair on DT {dt_id}: {len(affected_poles)} poles restoring")

        events = []
        now = datetime.now(timezone.utc)

        for pole_id in affected_poles:
            node_data = tree.nodes.get(pole_id, {})
            device_id = node_data.get("device_id")
            fw = node_data.get("fw_version", "1.4.2")

            if not device_id:
                continue

            # Boot event
            boot_evt = self._make_event(
                pole_id=pole_id, device_id=device_id,
                event="boot", energized=True, fw=fw, ts=now,
                battery_mv=3700,
            )
            events.append(boot_evt)

            # Power restored event (typically within 20s of boot)
            restore_ts = now + timedelta(seconds=self.rng.uniform(5, 20))
            restore_evt = self._make_event(
                pole_id=pole_id, device_id=device_id,
                event="power_restored", energized=True, fw=fw, ts=restore_ts,
                battery_mv=3700,
            )
            events.append(restore_evt)

        return events

    def generate_heartbeats(self, subset_ratio: float = 0.1) -> list[dict]:
        """Generate heartbeat events for a random subset of live poles."""
        events = []
        now = datetime.now(timezone.utc)

        for pole_id, state in self.engine.pole_states.items():
            if state.status != "live" or not state.has_device or not state.device_healthy:
                continue
            if self.rng.random() > subset_ratio:
                continue

            node_data = self.engine.network_graph.nodes.get(pole_id, {}) if self.engine.network_graph else {}
            device_id = node_data.get("device_id", state.device_id)
            fw = node_data.get("fw_version", state.fw_version or "1.4.2")

            if not device_id:
                continue

            evt = self._make_event(
                pole_id=pole_id, device_id=device_id,
                event="heartbeat", energized=True, fw=fw, ts=now,
            )
            events.append(evt)

        return events

    def _collect_subtree(self, root_id: str, tree: nx.DiGraph) -> list[str]:
        """Collect all nodes in a subtree."""
        result = [root_id]
        for child in tree.successors(root_id):
            result.extend(self._collect_subtree(child, tree))
        return result
