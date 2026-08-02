"""
Tests for the fault localization logic.

Required by the assignment checklist:
1. Single span fault → one correctly located ticket
2. DT-level fault → one DT ticket
3. Feeder-level fault → one feeder ticket
4. Three simultaneous faults → three tickets
5. Dead sensor with live children → no fault ticket
6. Scheduled outage → no fault ticket
7. Real restoration → auto-verified (covered in integration)
8. Premature "resolved" with dark poles → rejected (covered in integration)
"""
import pytest
from datetime import datetime, timezone, timedelta
import networkx as nx

from app.core.localization import LocalizationEngine, PoleRuntimeState, FaultBoundary


def _build_simple_dt_tree(dt_id="D-0001", num_poles=10, feeder_id="F-01-01"):
    """Build a simple linear DT tree for testing: DT → P1 → P2 → ... → Pn"""
    G = nx.DiGraph()

    # Add DT node
    G.add_node(dt_id, node_type="dt", lat=12.97, lon=77.59,
               feeder_id=feeder_id, has_surveyed_topology=True,
               households_served=100)

    # Add poles in a line
    prev = dt_id
    pole_ids = []
    for i in range(1, num_poles + 1):
        pid = f"P-{i:04d}"
        pole_ids.append(pid)
        G.add_node(pid, node_type="pole", lat=12.97 + i * 0.0004, lon=77.59,
                   dt_id=dt_id, feeder_id=feeder_id,
                   device_id=f"DEV-{i:04d}" if i % 10 != 0 else None,  # every 10th has no device
                   pincode="560078", ward="W-084",
                   topology_source="surveyed", topology_confidence="HIGH",
                   fw_version="1.4.2")
        G.add_edge(prev, pid, edge_type="span", topology_source="surveyed",
                   topology_confidence="HIGH")
        prev = pid

    return G, pole_ids


def _build_branching_dt_tree(dt_id="D-0001", feeder_id="F-01-01"):
    """Build a DT tree with a branch: DT → P1 → P2 → P3 → P4, P2 → P5 → P6"""
    G = nx.DiGraph()

    G.add_node(dt_id, node_type="dt", lat=12.97, lon=77.59,
               feeder_id=feeder_id, has_surveyed_topology=True,
               households_served=100)

    poles = ["P-0001", "P-0002", "P-0003", "P-0004", "P-0005", "P-0006"]

    for i, pid in enumerate(poles):
        G.add_node(pid, node_type="pole", lat=12.97 + (i + 1) * 0.0004, lon=77.59,
                   dt_id=dt_id, feeder_id=feeder_id,
                   device_id=f"DEV-{i + 1:04d}",
                   pincode="560078", ward="W-084",
                   topology_source="surveyed", topology_confidence="HIGH",
                   fw_version="1.4.2")

    # Main trunk: DT → P1 → P2 → P3 → P4
    G.add_edge(dt_id, "P-0001", edge_type="span", topology_source="surveyed", topology_confidence="HIGH")
    G.add_edge("P-0001", "P-0002", edge_type="span", topology_source="surveyed", topology_confidence="HIGH")
    G.add_edge("P-0002", "P-0003", edge_type="span", topology_source="surveyed", topology_confidence="HIGH")
    G.add_edge("P-0003", "P-0004", edge_type="span", topology_source="surveyed", topology_confidence="HIGH")
    # Branch: P2 → P5 → P6
    G.add_edge("P-0002", "P-0005", edge_type="span", topology_source="surveyed", topology_confidence="HIGH")
    G.add_edge("P-0005", "P-0006", edge_type="span", topology_source="surveyed", topology_confidence="HIGH")

    return G, poles


def _create_engine_with_tree(G, dt_id, pole_ids, feeder_id="F-01-01"):
    """Create a localization engine with a pre-built tree."""
    engine = LocalizationEngine()
    engine.network_graph = G
    engine.dt_trees = {dt_id: G}

    for pid in pole_ids:
        node_data = G.nodes[pid]
        engine.init_pole_state(
            pole_id=pid,
            device_id=node_data.get("device_id"),
            dt_id=dt_id,
            feeder_id=feeder_id,
            fw_version=node_data.get("fw_version"),
        )

    return engine


class TestSingleSpanFault:
    """Test 1: Single span fault → one correctly located ticket."""

    def test_span_fault_mid_line(self):
        """Fault between P-0005 and P-0006 should produce one boundary at that edge."""
        G, pole_ids = _build_simple_dt_tree(num_poles=10)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        # Set P-0006 through P-0009 as confirmed_dark (P-0010 has no device)
        for i in range(6, 10):
            pid = f"P-{i:04d}"
            state = engine.pole_states[pid]
            state.status = "confirmed_dark"
            state.confirmed_dark_at = datetime.now(timezone.utc)
        engine.dirty_dts.add("D-0001")

        boundaries, anomalies = engine.run_sweep()

        assert len(boundaries) == 1, f"Expected 1 boundary, got {len(boundaries)}"
        assert boundaries[0].boundary_live_pole == "P-0005"
        assert boundaries[0].boundary_dark_pole == "P-0006"
        assert boundaries[0].fault_type == "span"
        assert len(boundaries[0].affected_poles) >= 4  # P6-P9 (P10 has no device)

    def test_span_fault_at_start(self):
        """Fault at the first pole — DT is live, P-0001 is dark."""
        G, pole_ids = _build_simple_dt_tree(num_poles=5)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        # All poles dark
        for pid in pole_ids:
            state = engine.pole_states.get(pid)
            if state:
                state.status = "confirmed_dark"
                state.confirmed_dark_at = datetime.now(timezone.utc)
        engine.dirty_dts.add("D-0001")

        boundaries, anomalies = engine.run_sweep()

        # All poles dark under DT → should be DT-level fault, not span
        assert len(boundaries) == 1
        assert boundaries[0].fault_type == "dt"


class TestDTLevelFault:
    """Test 2: DT-level fault → one DT ticket."""

    def test_all_poles_dark(self):
        """All poles under a DT dark = DT-level fault."""
        G, pole_ids = _build_simple_dt_tree(num_poles=8)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        for pid in pole_ids:
            state = engine.pole_states.get(pid)
            if state:
                state.status = "confirmed_dark"
                state.confirmed_dark_at = datetime.now(timezone.utc)
        engine.dirty_dts.add("D-0001")

        boundaries, anomalies = engine.run_sweep()

        assert len(boundaries) == 1
        assert boundaries[0].fault_type == "dt"
        assert boundaries[0].dt_id == "D-0001"


class TestSimultaneousFaults:
    """Test 4: Three simultaneous faults → three tickets."""

    def test_three_separate_dts(self):
        """Three faults on three different DTs should produce three boundaries."""
        G = nx.DiGraph()

        # Create a feeder with 3 DTs
        G.add_node("F-01-01", node_type="feeder", substation_id="SS-01")

        all_pole_ids = []
        for dt_num in range(1, 4):
            dt_id = f"D-{dt_num:04d}"
            G.add_node(dt_id, node_type="dt", lat=12.97, lon=77.59 + dt_num * 0.01,
                       feeder_id="F-01-01", has_surveyed_topology=True,
                       households_served=100)
            G.add_edge("F-01-01", dt_id, edge_type="dt")

            prev = dt_id
            for i in range(1, 6):
                pid = f"P-{dt_num}00{i}"
                all_pole_ids.append(pid)
                G.add_node(pid, node_type="pole", lat=12.97 + i * 0.0004,
                           lon=77.59 + dt_num * 0.01,
                           dt_id=dt_id, feeder_id="F-01-01",
                           device_id=f"DEV-{dt_num}00{i}",
                           pincode="560078", ward="W-084",
                           topology_source="surveyed", topology_confidence="HIGH",
                           fw_version="1.4.2")
                G.add_edge(prev, pid, edge_type="span", topology_source="surveyed",
                           topology_confidence="HIGH")
                prev = pid

        engine = LocalizationEngine()
        engine.network_graph = G
        engine.dt_trees = {
            f"D-{n:04d}": G.subgraph(
                [f"D-{n:04d}"] + [f"P-{n}00{i}" for i in range(1, 6)]
            ).copy()
            for n in range(1, 4)
        }

        for pid in all_pole_ids:
            node_data = G.nodes[pid]
            engine.init_pole_state(pid, node_data.get("device_id"),
                                   node_data.get("dt_id"), "F-01-01", "1.4.2")

        # Inject faults: each DT has poles 3-5 dark (fault between P2 and P3)
        for dt_num in range(1, 4):
            for i in range(3, 6):
                pid = f"P-{dt_num}00{i}"
                state = engine.pole_states[pid]
                state.status = "confirmed_dark"
                state.confirmed_dark_at = datetime.now(timezone.utc)
            engine.dirty_dts.add(f"D-{dt_num:04d}")

        boundaries, anomalies = engine.run_sweep()

        assert len(boundaries) == 3, f"Expected 3 boundaries, got {len(boundaries)}"
        # Each should be a span fault
        for b in boundaries:
            assert b.fault_type == "span"


class TestDeadSensorDetection:
    """Test 5: Dead sensor with live children → no fault ticket."""

    def test_isolated_dark_with_live_children(self):
        """A single dark pole with all live children is a device anomaly, not a fault."""
        G, pole_ids = _build_branching_dt_tree()
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        # P-0002 is dark, but P-0003, P-0004, P-0005, P-0006 are all live
        engine.pole_states["P-0002"].status = "confirmed_dark"
        engine.pole_states["P-0002"].confirmed_dark_at = datetime.now(timezone.utc)
        engine.dirty_dts.add("D-0001")

        boundaries, anomalies = engine.run_sweep()

        assert len(boundaries) == 0, f"Expected 0 boundaries, got {len(boundaries)}"
        assert len(anomalies) == 1
        assert anomalies[0].pole_id == "P-0002"
        assert anomalies[0].reason == "isolated_dark_with_live_children"


class TestScheduledOutageSuppression:
    """Test 6: Scheduled outage → no fault ticket."""

    def test_outage_suppresses_ticket(self):
        """A fault during a scheduled outage window should be suppressed."""
        G, pole_ids = _build_simple_dt_tree(num_poles=6)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        # Set up a scheduled outage for this DT
        now = datetime.now(timezone.utc)
        engine.active_outages["D-0001"] = {
            "outage_id": "SO-001",
            "scope": "dt",
            "target_id": "D-0001",
            "scheduled_start": now - timedelta(hours=1),
            "grace_end": now + timedelta(minutes=30),
            "cancelled": False,
        }

        # Make poles dark
        for i in range(3, 7):
            pid = f"P-{i:04d}"
            state = engine.pole_states.get(pid)
            if state:
                state.status = "confirmed_dark"
                state.confirmed_dark_at = now
        engine.dirty_dts.add("D-0001")

        boundaries, anomalies = engine.run_sweep()

        assert len(boundaries) == 0, f"Expected 0 boundaries during outage, got {len(boundaries)}"


class TestConfirmationWindow:
    """Test that suspected_dark poles need confirmation before boundaries are detected."""

    def test_suspected_dark_no_boundary(self):
        """Poles in suspected_dark should not produce boundaries."""
        G, pole_ids = _build_simple_dt_tree(num_poles=6)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        # Set poles as suspected (not confirmed)
        for i in range(4, 7):
            pid = f"P-{i:04d}"
            state = engine.pole_states.get(pid)
            if state:
                state.status = "suspected_dark"
                state.suspected_dark_at = datetime.now(timezone.utc)
        engine.dirty_dts.add("D-0001")

        boundaries, anomalies = engine.run_sweep()

        # No boundaries should be detected for suspected-dark poles
        assert len(boundaries) == 0


class TestCorroborationShortCircuit:
    """Test that corroboration promotes suspected poles immediately."""

    def test_three_poles_corroborate(self):
        """≥3 suspected poles on same DT within window → immediate promotion."""
        G, pole_ids = _build_simple_dt_tree(num_poles=8)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        now = datetime.now(timezone.utc)

        # Set 4 poles as suspected_dark within the corroboration window
        for i in range(5, 9):
            pid = f"P-{i:04d}"
            state = engine.pole_states.get(pid)
            if state:
                state.status = "suspected_dark"
                state.suspected_dark_at = now

        # Add to corroboration buffer
        engine._corroboration_buffer["D-0001"] = [
            (f"P-{i:04d}", now) for i in range(5, 9)
        ]
        engine.dirty_dts.add("D-0001")

        boundaries, anomalies = engine.run_sweep()

        # Should have promoted and detected the boundary
        assert len(boundaries) == 1
        assert boundaries[0].boundary_live_pole == "P-0004"
        assert boundaries[0].fault_type == "span"


class TestConfidenceLabelling:
    """Test confidence label computation."""

    def test_high_confidence(self):
        """Surveyed topology + explicit power_lost + corroboration → HIGH."""
        G, pole_ids = _build_simple_dt_tree(num_poles=8)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        # Create a boundary with good evidence
        boundary = FaultBoundary(
            boundary_live_pole="P-0004",
            boundary_dark_pole="P-0005",
            dt_id="D-0001",
            feeder_id="F-01-01",
            fault_type="span",
            affected_poles=["P-0005", "P-0006", "P-0007", "P-0008"],
            topology_source="surveyed",
            topology_confidence="HIGH",
        )

        # Set up states for confidence computation
        engine.pole_states["P-0005"].status = "confirmed_dark"
        engine.pole_states["P-0005"].last_event = "power_lost"
        for i in range(6, 9):
            engine.pole_states[f"P-{i:04d}"].status = "confirmed_dark"

        label, factors = engine.compute_confidence(boundary)
        assert label == "HIGH"

    def test_low_confidence_inferred_range(self):
        """Inferred topology + uninstrumented gap → LOW."""
        G, pole_ids = _build_simple_dt_tree(num_poles=5)
        engine = _create_engine_with_tree(G, "D-0001", pole_ids)

        boundary = FaultBoundary(
            boundary_live_pole="P-0002",
            boundary_dark_pole="P-0004",
            dt_id="D-0001",
            feeder_id="F-01-01",
            fault_type="span",
            affected_poles=["P-0004", "P-0005"],
            is_range=True,
            uninstrumented_count=1,
            topology_source="inferred_gps",
            topology_confidence="MEDIUM",
        )

        label, factors = engine.compute_confidence(boundary)
        assert label == "LOW"
