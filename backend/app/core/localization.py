"""
Fault localization engine.

Implements the four-stage pipeline:
1. De-duplication & state update
2. Adaptive confirmation (corroboration short-circuit + 60s default)
3. Boundary detection (tree walk for live→dark frontiers)
4. Grouping & ticketing

Driven by a 10-second periodic sweep, not per-pole timers.
See design doc §2 for algorithm details.
"""
import logging
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass, field
from typing import Optional
import networkx as nx

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass
class PoleRuntimeState:
    """In-memory runtime state for a single pole."""
    pole_id: str
    status: str = "unknown"  # live | suspected_dark | confirmed_dark | unknown | device_dead
    last_seen: Optional[datetime] = None
    last_event: Optional[str] = None
    device_healthy: bool = True
    fw_version: Optional[str] = None
    suspected_dark_at: Optional[datetime] = None
    confirmed_dark_at: Optional[datetime] = None
    device_id: Optional[str] = None
    dt_id: Optional[str] = None
    feeder_id: Optional[str] = None
    has_device: bool = True


@dataclass
class FaultBoundary:
    """A detected live→dark boundary on the network tree."""
    boundary_live_pole: Optional[str]  # last live pole (None for DT-level faults)
    boundary_dark_pole: Optional[str]  # first dark pole (None for DT-level faults)
    dt_id: str
    feeder_id: str
    fault_type: str  # "span" | "dt" | "feeder"
    affected_poles: list[str] = field(default_factory=list)
    is_range: bool = False
    range_description: Optional[str] = None
    uninstrumented_count: int = 0
    topology_source: str = "unknown"
    topology_confidence: str = "MEDIUM"
    detected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class DeviceAnomaly:
    """A pole flagged as a device/equipment anomaly, not a line fault."""
    pole_id: str
    dt_id: str
    reason: str  # "isolated_dark_with_live_children" | "sensor_dead"


class LocalizationEngine:
    """
    Core fault localization engine.
    
    Maintains pole state, runs periodic sweeps, detects fault boundaries,
    and produces fault candidates for the ticket manager.
    """

    def __init__(self):
        # Current pole state — authoritative runtime view
        self.pole_states: dict[str, PoleRuntimeState] = {}
        # De-duplication: device_id → last seen seq
        self.device_seq_cache: dict[str, int] = {}
        # Boot tracking: device_id → seq at last boot
        self.device_boot_seq: dict[str, int] = {}
        # DTs with state changes since last sweep
        self.dirty_dts: set[str] = set()
        # Corroboration tracking: dt_id → list of (pole_id, suspected_at) in current window
        self._corroboration_buffer: dict[str, list[tuple[str, datetime]]] = {}
        # Network graph (set by app on startup)
        self.network_graph: Optional[nx.DiGraph] = None
        self.dt_trees: dict[str, nx.DiGraph] = {}
        # Scheduled outages cache
        self.active_outages: dict[str, dict] = {}  # target_id → outage info
        # Ticket counter for display IDs
        self._ticket_counter = 0

    def init_pole_state(self, pole_id: str, device_id: Optional[str],
                        dt_id: str, feeder_id: str, fw_version: Optional[str]):
        """Initialize a pole's runtime state (called during startup)."""
        self.pole_states[pole_id] = PoleRuntimeState(
            pole_id=pole_id,
            status="live" if device_id else "unknown",
            device_id=device_id,
            dt_id=dt_id,
            feeder_id=feeder_id,
            fw_version=fw_version,
            has_device=device_id is not None,
            last_seen=datetime.now(timezone.utc),
        )

    def is_duplicate(self, device_id: str, seq: int, event: str) -> bool:
        """Check if this event is a duplicate based on device_id + seq."""
        if event == "boot":
            # Boot resets the sequence counter
            self.device_boot_seq[device_id] = seq
            self.device_seq_cache[device_id] = seq
            return False

        last_seq = self.device_seq_cache.get(device_id)
        if last_seq is not None and seq <= last_seq:
            return True

        self.device_seq_cache[device_id] = seq
        return False

    def process_event(self, pole_id: str, device_id: str, event: str,
                      energized: bool, ts: datetime, seq: int,
                      fw: Optional[str] = None, battery_mv: Optional[int] = None,
                      rssi: Optional[int] = None) -> bool:
        """
        Process a single telemetry event. Updates pole state.
        Returns True if the event was processed (not a duplicate).
        """
        # De-duplication
        if self.is_duplicate(device_id, seq, event):
            return False

        state = self.pole_states.get(pole_id)
        if state is None:
            logger.warning(f"Event for unknown pole {pole_id}, ignoring")
            return False

        now = datetime.now(timezone.utc)
        state.last_seen = now
        state.last_event = event
        state.device_healthy = True
        if fw:
            state.fw_version = fw

        if event in ("power_lost",) and not energized:
            if state.status != "confirmed_dark":
                state.status = "suspected_dark"
                state.suspected_dark_at = now
                self.dirty_dts.add(state.dt_id)
                # Add to corroboration buffer
                buf = self._corroboration_buffer.setdefault(state.dt_id, [])
                buf.append((pole_id, now))

        elif event in ("power_restored", "heartbeat", "boot") and energized:
            was_dark = state.status in ("suspected_dark", "confirmed_dark")
            state.status = "live"
            state.suspected_dark_at = None
            state.confirmed_dark_at = None
            if was_dark:
                self.dirty_dts.add(state.dt_id)

        elif event == "heartbeat" and not energized:
            # Heartbeat reporting not-energized
            if state.status not in ("suspected_dark", "confirmed_dark"):
                state.status = "suspected_dark"
                state.suspected_dark_at = now
                self.dirty_dts.add(state.dt_id)

        return True

    def run_sweep(self) -> tuple[list[FaultBoundary], list[DeviceAnomaly]]:
        """
        Run the periodic detection sweep. Called every ~10 seconds.
        
        1. Check heartbeat timeouts for fw 1.2 devices
        2. Promote suspected_dark → confirmed_dark where window elapsed
        3. Check for corroboration short-circuits
        4. Run boundary detection on dirty DTs
        
        Returns (fault_boundaries, device_anomalies)
        """
        now = datetime.now(timezone.utc)
        confirmation_window = timedelta(seconds=settings.confirmation_window_seconds)
        corroboration_window = timedelta(seconds=settings.corroboration_window_seconds)
        heartbeat_timeout = timedelta(minutes=16)  # 15min + 45s jitter + 15s margin

        # --- Step 1: Heartbeat timeout check for fw 1.2 devices ---
        for pole_id, state in self.pole_states.items():
            if not state.has_device or not state.device_healthy:
                continue
            if state.fw_version and state.fw_version.startswith("1.2"):
                if (state.status == "live" and state.last_seen and
                        now - state.last_seen > heartbeat_timeout):
                    state.status = "suspected_dark"
                    state.suspected_dark_at = now
                    self.dirty_dts.add(state.dt_id)
            # Also check for any device that hasn't been heard from in a long time
            elif (state.status == "live" and state.last_seen and
                  now - state.last_seen > heartbeat_timeout * 2):
                # Device might be dead (not a power issue)
                state.device_healthy = False
                state.status = "unknown"

        # --- Step 2: Corroboration short-circuit ---
        for dt_id, buf in list(self._corroboration_buffer.items()):
            # Remove stale entries
            buf = [(pid, t) for pid, t in buf if now - t < corroboration_window]
            self._corroboration_buffer[dt_id] = buf

            if len(buf) >= settings.corroboration_threshold:
                # Short-circuit: promote all suspected poles on this DT immediately
                for pid, _ in buf:
                    s = self.pole_states.get(pid)
                    if s and s.status == "suspected_dark":
                        s.status = "confirmed_dark"
                        s.confirmed_dark_at = now
                self.dirty_dts.add(dt_id)
                self._corroboration_buffer[dt_id] = []

        # --- Step 3: Promote suspected_dark → confirmed_dark (default window) ---
        for pole_id, state in self.pole_states.items():
            if (state.status == "suspected_dark" and state.suspected_dark_at and
                    now - state.suspected_dark_at >= confirmation_window):
                state.status = "confirmed_dark"
                state.confirmed_dark_at = now
                self.dirty_dts.add(state.dt_id)

        # --- Step 4: Boundary detection on dirty DTs ---
        all_boundaries = []
        all_anomalies = []

        for dt_id in list(self.dirty_dts):
            if dt_id not in self.dt_trees:
                continue
            tree = self.dt_trees[dt_id]
            boundaries, anomalies = self._detect_boundaries_for_dt(dt_id, tree, now)
            all_boundaries.extend(boundaries)
            all_anomalies.extend(anomalies)

        self.dirty_dts.clear()

        # --- Step 5: Check for feeder-level faults ---
        feeder_boundaries = self._detect_feeder_faults(all_boundaries)
        if feeder_boundaries:
            # Replace individual DT boundaries with feeder-level boundary
            affected_dt_ids = {fb.dt_id for fb in feeder_boundaries}
            all_boundaries = [b for b in all_boundaries if b.dt_id not in affected_dt_ids]
            all_boundaries.extend(feeder_boundaries)

        return all_boundaries, all_anomalies

    def _detect_boundaries_for_dt(
        self, dt_id: str, tree: nx.DiGraph, now: datetime
    ) -> tuple[list[FaultBoundary], list[DeviceAnomaly]]:
        """Detect fault boundaries within a single DT's subtree."""
        boundaries = []
        anomalies = []

        # Get DT node attributes
        dt_data = tree.nodes.get(dt_id, {})
        feeder_id = dt_data.get("feeder_id", "")
        topology_source = dt_data.get("has_surveyed_topology", False)

        # Collect all pole IDs under this DT
        pole_ids_in_dt = [n for n in tree.nodes if tree.nodes[n].get("node_type") == "pole"]
        if not pole_ids_in_dt:
            return boundaries, anomalies

        # Check if ALL poles are dark → DT-level fault
        dark_count = sum(1 for pid in pole_ids_in_dt
                        if self.pole_states.get(pid, PoleRuntimeState(pid)).status == "confirmed_dark")
        unknown_count = sum(1 for pid in pole_ids_in_dt
                          if self.pole_states.get(pid, PoleRuntimeState(pid)).status in ("unknown",))

        # Check if it's suppressed by scheduled outage
        if self._is_outage_suppressed(dt_id, feeder_id):
            return boundaries, anomalies

        if dark_count > 0 and dark_count + unknown_count == len(pole_ids_in_dt):
            # All poles dark or unknown → DT-level fault
            boundary = FaultBoundary(
                boundary_live_pole=None,
                boundary_dark_pole=None,
                dt_id=dt_id,
                feeder_id=feeder_id,
                fault_type="dt",
                affected_poles=pole_ids_in_dt,
                topology_source="surveyed" if topology_source else "inferred_gps",
                topology_confidence="HIGH",
                detected_at=now,
            )
            boundaries.append(boundary)
            return boundaries, anomalies

        # Walk the tree from DT root to find live→dark boundaries
        self._walk_tree_for_boundaries(
            dt_id, dt_id, tree, feeder_id, boundaries, anomalies, now
        )

        return boundaries, anomalies

    def _walk_tree_for_boundaries(
        self, node_id: str, dt_id: str, tree: nx.DiGraph,
        feeder_id: str, boundaries: list, anomalies: list,
        now: datetime, parent_status: str = "live"
    ):
        """Recursive tree walk to find live→dark boundaries."""
        children = list(tree.successors(node_id))
        if not children:
            return

        for child_id in children:
            child_data = tree.nodes.get(child_id, {})
            if child_data.get("node_type") != "pole":
                continue

            child_state = self.pole_states.get(child_id, PoleRuntimeState(child_id))
            edge_data = tree.edges.get((node_id, child_id), {})
            topo_source = edge_data.get("topology_source", "unknown")
            topo_conf = edge_data.get("topology_confidence", "MEDIUM")

            if parent_status == "live" and child_state.status == "confirmed_dark":
                # BOUNDARY FOUND: live → dark
                # Check for the isolated-dark-with-live-children anomaly
                grandchildren = list(tree.successors(child_id))
                gc_states = [self.pole_states.get(gc, PoleRuntimeState(gc))
                            for gc in grandchildren
                            if tree.nodes.get(gc, {}).get("node_type") == "pole"]
                live_grandchildren = [s for s in gc_states if s.status == "live"]

                if live_grandchildren and len(live_grandchildren) == len(gc_states):
                    # Isolated dark pole with ALL live children = device anomaly
                    anomalies.append(DeviceAnomaly(
                        pole_id=child_id,
                        dt_id=dt_id,
                        reason="isolated_dark_with_live_children",
                    ))
                    # Continue walking — power is flowing through this pole
                    self._walk_tree_for_boundaries(
                        child_id, dt_id, tree, feeder_id,
                        boundaries, anomalies, now, parent_status="live"
                    )
                    continue

                # Real fault boundary
                affected = self._collect_dark_subtree(child_id, tree)
                boundary = FaultBoundary(
                    boundary_live_pole=node_id if node_id != dt_id else None,
                    boundary_dark_pole=child_id,
                    dt_id=dt_id,
                    feeder_id=feeder_id,
                    fault_type="span",
                    affected_poles=affected,
                    topology_source=topo_source,
                    topology_confidence=topo_conf,
                    detected_at=now,
                )
                boundaries.append(boundary)
                # Don't walk further — everything downstream is affected
                # But DO walk to find potential cascaded faults that would be hidden
                # (these will only become visible after this fault is repaired)

            elif parent_status == "live" and child_state.status in ("unknown",):
                # Unknown status (no device or device dead) — walk through
                # to see if grandchildren are dark
                gc_ids = list(tree.successors(child_id))
                gc_poles = [gc for gc in gc_ids
                           if tree.nodes.get(gc, {}).get("node_type") == "pole"]

                if gc_poles:
                    has_dark_gc = any(
                        self.pole_states.get(gc, PoleRuntimeState(gc)).status == "confirmed_dark"
                        for gc in gc_poles
                    )
                    has_live_gc = any(
                        self.pole_states.get(gc, PoleRuntimeState(gc)).status == "live"
                        for gc in gc_poles
                    )

                    if has_dark_gc and not has_live_gc:
                        # All known grandchildren dark → fault in the gap
                        affected = self._collect_dark_subtree(child_id, tree)
                        uninstrumented = 1  # at least the unknown pole
                        boundary = FaultBoundary(
                            boundary_live_pole=node_id if node_id != dt_id else None,
                            boundary_dark_pole=child_id,
                            dt_id=dt_id,
                            feeder_id=feeder_id,
                            fault_type="span",
                            affected_poles=affected,
                            is_range=True,
                            range_description=f"Between {node_id} (live) and nearest dark pole (uninstrumented gap of {uninstrumented} pole(s))",
                            uninstrumented_count=uninstrumented,
                            topology_source=topo_source,
                            topology_confidence="LOW",
                            detected_at=now,
                        )
                        boundaries.append(boundary)
                    elif has_live_gc:
                        # Some grandchildren live → power is flowing through, keep walking
                        self._walk_tree_for_boundaries(
                            child_id, dt_id, tree, feeder_id,
                            boundaries, anomalies, now, parent_status="live"
                        )
                else:
                    # No grandchildren to check — can't determine
                    pass

            elif parent_status == "live" and child_state.status == "live":
                # Both live — continue walking
                self._walk_tree_for_boundaries(
                    child_id, dt_id, tree, feeder_id,
                    boundaries, anomalies, now, parent_status="live"
                )

            elif parent_status == "live" and child_state.status == "suspected_dark":
                # Still in confirmation window — don't act yet, but keep walking
                # in case downstream poles are already confirmed
                self._walk_tree_for_boundaries(
                    child_id, dt_id, tree, feeder_id,
                    boundaries, anomalies, now, parent_status="live"
                )

            # If parent is dark, don't report — it's downstream of an existing fault

    def _collect_dark_subtree(self, root_id: str, tree: nx.DiGraph) -> list[str]:
        """Collect all poles in the subtree rooted at root_id that are dark or unknown."""
        affected = [root_id]
        for child in tree.successors(root_id):
            if tree.nodes.get(child, {}).get("node_type") != "pole":
                continue
            child_state = self.pole_states.get(child, PoleRuntimeState(child))
            if child_state.status in ("confirmed_dark", "suspected_dark", "unknown"):
                affected.extend(self._collect_dark_subtree(child, tree))
        return affected

    def _detect_feeder_faults(self, dt_boundaries: list[FaultBoundary]) -> list[FaultBoundary]:
        """Check if all DTs on a feeder are dark → feeder-level fault."""
        feeder_dt_faults: dict[str, list[FaultBoundary]] = {}
        for b in dt_boundaries:
            if b.fault_type == "dt":
                feeder_dt_faults.setdefault(b.feeder_id, []).append(b)

        feeder_boundaries = []
        # Check each feeder: if ALL its DTs have DT-level faults, it's a feeder fault
        if self.network_graph:
            for feeder_id, dt_faults in feeder_dt_faults.items():
                # Skip if feeder node doesn't exist in graph
                if feeder_id not in self.network_graph:
                    continue
                # Get all DTs on this feeder
                feeder_dts = [n for n in self.network_graph.successors(feeder_id)
                             if self.network_graph.nodes[n].get("node_type") == "dt"]
                if len(dt_faults) >= len(feeder_dts) and len(feeder_dts) > 0:
                    # All DTs on this feeder are dark → feeder-level fault
                    all_affected = []
                    for dtf in dt_faults:
                        all_affected.extend(dtf.affected_poles)
                    feeder_boundaries.append(FaultBoundary(
                        boundary_live_pole=None,
                        boundary_dark_pole=None,
                        dt_id=None,
                        feeder_id=feeder_id,
                        fault_type="feeder",
                        affected_poles=all_affected,
                        topology_source="surveyed",
                        topology_confidence="HIGH",
                        detected_at=dt_faults[0].detected_at,
                    ))

        return feeder_boundaries

    def _is_outage_suppressed(self, dt_id: str, feeder_id: str) -> bool:
        """Check if a DT or its feeder is currently in a scheduled outage window."""
        now = datetime.now(timezone.utc)
        for target_id in (dt_id, feeder_id):
            outage = self.active_outages.get(target_id)
            if outage and not outage.get("cancelled", False):
                grace_end = outage.get("grace_end")
                scheduled_start = outage.get("scheduled_start")
                if scheduled_start and grace_end:
                    if scheduled_start <= now <= grace_end:
                        return True
        return False

    def compute_confidence(self, boundary: FaultBoundary) -> tuple[str, dict]:
        """
        Compute confidence label based on observable criteria.
        Returns (label, factors_dict).
        """
        factors = {
            "topology_source": boundary.topology_source,
            "topology_confidence": boundary.topology_confidence,
            "affected_pole_count": len(boundary.affected_poles),
            "is_range": boundary.is_range,
            "uninstrumented_count": boundary.uninstrumented_count,
            "fault_type": boundary.fault_type,
        }

        # Check for explicit power_lost at boundary
        if boundary.boundary_dark_pole:
            dark_state = self.pole_states.get(boundary.boundary_dark_pole)
            factors["detection_method"] = "explicit_power_lost" if (
                dark_state and dark_state.last_event == "power_lost"
            ) else "heartbeat_timeout"
            factors["fw_version"] = dark_state.fw_version if dark_state else None

        # Corroborating dark downstream poles
        corroborating = len([p for p in boundary.affected_poles
                           if self.pole_states.get(p, PoleRuntimeState(p)).status == "confirmed_dark"])
        factors["corroborating_poles"] = corroborating

        # Determine label
        is_surveyed = boundary.topology_source == "surveyed"
        has_explicit_power_lost = factors.get("detection_method") == "explicit_power_lost"
        has_corroboration = corroborating >= 2

        if boundary.fault_type in ("dt", "feeder"):
            label = "HIGH"  # DT/feeder faults are unambiguous
        elif is_surveyed and has_explicit_power_lost and has_corroboration:
            label = "HIGH"
        elif boundary.is_range or boundary.uninstrumented_count > 0:
            label = "LOW"
        elif factors.get("fw_version", "").startswith("1.2"):
            label = "LOW"
        elif is_surveyed or (not is_surveyed and boundary.topology_confidence == "HIGH"):
            label = "MEDIUM"
        elif corroborating >= 1:
            label = "MEDIUM"
        else:
            label = "LOW"

        return label, factors

    def next_display_id(self) -> str:
        """Generate the next human-readable ticket display ID."""
        self._ticket_counter += 1
        date_str = datetime.now(timezone.utc).strftime("%Y%m%d")
        return f"FLT-{date_str}-{self._ticket_counter:03d}"
