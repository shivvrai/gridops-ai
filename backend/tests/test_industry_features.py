"""
Tests for industry-ready features:
1. Distance calculation on edges, fault boundaries, and ticket priority scoring
2. Scheduled outage management and suppression
3. Reliability indices (SAIDI, SAIFI, CAIDI) analytics computation
4. Data loader CSV validation
"""
import pytest
from datetime import datetime, timezone, timedelta
import networkx as nx
import io

from app.core.localization import LocalizationEngine, PoleRuntimeState, FaultBoundary
from app.core.ticket_manager import TicketManager
from app.core.topology import _haversine_m


def _build_test_tree_with_distances():
    """Build a linear DT tree with distance_m attributes on edges:
    DT (12.970, 77.590)
      -> P-0001 (12.9704, 77.590) ~44m
      -> P-0002 (12.9708, 77.590) ~44m
      -> P-0003 (12.9712, 77.590) ~44m
    """
    G = nx.DiGraph()
    dt_id = "D-0001"
    feeder_id = "F-01-01"

    G.add_node(dt_id, node_type="dt", lat=12.970, lon=77.590,
               feeder_id=feeder_id, has_surveyed_topology=True,
               households_served=120)

    poles = ["P-0001", "P-0002", "P-0003"]
    prev = dt_id
    for i, pid in enumerate(poles, 1):
        lat = 12.970 + i * 0.0004
        lon = 77.590
        dist = 44.5
        G.add_node(pid, node_type="pole", lat=lat, lon=lon,
                   dt_id=dt_id, feeder_id=feeder_id,
                   device_id=f"DEV-{i:04d}", pincode="560078",
                   topology_source="surveyed", topology_confidence="HIGH")
        G.add_edge(prev, pid, edge_type="span", topology_source="surveyed",
                   topology_confidence="HIGH", distance_m=dist)
        prev = pid

    return G, poles


class TestDistanceMetrics:
    def test_haversine_distance(self):
        # ~111km per degree of latitude
        dist = _haversine_m(12.9700, 77.5900, 12.9709, 77.5900)
        assert 90 <= dist <= 110

    def test_boundary_distance_metrics(self):
        G, poles = _build_test_tree_with_distances()
        engine = LocalizationEngine()
        engine.network_graph = G
        engine.dt_trees = {"D-0001": G}
        now = datetime.now(timezone.utc)

        # DT and P-0001 are live, P-0002 and P-0003 are dark
        engine.pole_states["P-0001"] = PoleRuntimeState(pole_id="P-0001", status="live")
        engine.pole_states["P-0002"] = PoleRuntimeState(pole_id="P-0002", status="confirmed_dark",
                                                         confirmed_dark_at=now)
        engine.pole_states["P-0003"] = PoleRuntimeState(pole_id="P-0003", status="confirmed_dark",
                                                         confirmed_dark_at=now)

        boundaries, anomalies = engine._detect_boundaries_for_dt("D-0001", G, now)
        assert len(boundaries) == 1
        b = boundaries[0]
        assert b.boundary_live_pole == "P-0001"
        assert b.boundary_dark_pole == "P-0002"
        # Span distance should be ~44.5m
        assert b.span_distance_m == 44.5
        # Total dark line should be P-0002 + P-0003 span = 44.5m
        assert b.total_dark_line_length_m == 44.5
        # Distance from DT to P-0001 is 44.5m
        assert b.dt_distance_m == 44.5

    def test_priority_score_computation(self):
        G, poles = _build_test_tree_with_distances()
        engine = LocalizationEngine()
        engine.network_graph = G
        engine.dt_trees = {"D-0001": G}
        tm = TicketManager(engine)

        boundary = FaultBoundary(
            boundary_live_pole="P-0001",
            boundary_dark_pole="P-0002",
            dt_id="D-0001",
            feeder_id="F-01-01",
            fault_type="span",
            affected_poles=["P-0002", "P-0003"],
            topology_source="surveyed",
            topology_confidence="HIGH",
            detected_at=datetime.now(timezone.utc),
            span_distance_m=45.0,
            total_dark_line_length_m=90.0,
            dt_distance_m=45.0,
        )

        score = tm._compute_priority(boundary, estimated_households=80)
        # score = affected_poles*2 (4) + households*1 (80) + dark_line/10 (9) = 93.0
        assert score >= 90.0

        # Feeder fault should have massive priority bonus
        feeder_boundary = FaultBoundary(
            boundary_live_pole=None,
            boundary_dark_pole=None,
            dt_id="D-0001",
            feeder_id="F-01-01",
            fault_type="feeder",
            affected_poles=["P-0001", "P-0002", "P-0003"],
            topology_source="surveyed",
            topology_confidence="HIGH",
            detected_at=datetime.now(timezone.utc),
            total_dark_line_length_m=135.0,
        )
        feeder_score = tm._compute_priority(feeder_boundary, estimated_households=120)
        assert feeder_score >= 500


from app.api.data_loader import _validate_csv_rows, POLE_REQUIRED, DT_REQUIRED
import csv
import io


class TestCsvValidation:
    def test_validate_valid_poles_csv(self):
        csv_content = (
            "pole_id,lat,lon,feeder_id,dt_id,device_id,pincode\n"
            "P-TEST-01,12.9716,77.5946,F-01-01,D-0001,DEV-001,560001\n"
            "P-TEST-02,12.9720,77.5950,F-01-01,D-0001,,560001\n"
        )
        rows = list(csv.DictReader(io.StringIO(csv_content)))
        result = _validate_csv_rows(rows, POLE_REQUIRED, "pole")
        assert result["valid_rows"] == 2
        assert result["invalid_rows"] == 0

    def test_validate_missing_required_column(self):
        csv_content = (
            "pole_id,lat,feeder_id\n"
            "P-TEST-01,12.9716,F-01-01\n"
        )
        rows = list(csv.DictReader(io.StringIO(csv_content)))
        result = _validate_csv_rows(rows, POLE_REQUIRED, "pole")
        assert result["invalid_rows"] == 1
        assert any("Missing required column" in err for err in result["invalid_details"][0]["errors"])

    def test_validate_invalid_coordinates(self):
        csv_content = (
            "pole_id,lat,lon,feeder_id,dt_id\n"
            "P-TEST-01,999.0,77.5946,F-01-01,D-0001\n"
        )
        rows = list(csv.DictReader(io.StringIO(csv_content)))
        result = _validate_csv_rows(rows, POLE_REQUIRED, "pole")
        # 999.0 lat triggers an out-of-range warning
        assert any("outside India range" in w for w in result["warnings"])

    def test_validate_valid_dts_csv(self):
        csv_content = (
            "dt_id,feeder_id,lat,lon,capacity_kva,households_served\n"
            "D-TEST-01,F-01-01,12.9700,77.5900,250,150\n"
        )
        rows = list(csv.DictReader(io.StringIO(csv_content)))
        result = _validate_csv_rows(rows, DT_REQUIRED, "dt")
        assert result["valid_rows"] == 1
        assert result["invalid_rows"] == 0


from app.api.analytics import _compute_reliability, _to_utc
from unittest.mock import AsyncMock, MagicMock


class TestAnalyticsReliability:
    @pytest.mark.asyncio
    async def test_compute_reliability_empty(self):
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        mock_db = AsyncMock()
        mock_db.execute.return_value = mock_result

        result = await _compute_reliability(mock_db, total_customers=1000)
        assert result["saifi"] == 0
        assert result["saidi"] == 0
        assert result["caidi"] == 0

    @pytest.mark.asyncio
    async def test_compute_reliability_with_tickets(self):
        mock_ticket = MagicMock()
        mock_ticket.estimated_households = 50
        now = datetime.now(timezone.utc)
        mock_ticket.detected_at = now - timedelta(minutes=30)
        mock_ticket.verified_at = now
        mock_ticket.closed_at = None

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = [mock_ticket]
        mock_db = AsyncMock()
        mock_db.execute.return_value = mock_result

        result = await _compute_reliability(mock_db, total_customers=500)
        # SAIFI = 50 / 500 = 0.1
        assert result["saifi"] == 0.1
        # SAIDI = (50 * 30) / 500 = 3.0
        assert result["saidi"] == 3.0
        # CAIDI = 3.0 / 0.1 = 30.0
        assert result["caidi"] == 30.0

    def test_to_utc_naive_conversion(self):
        naive = datetime(2026, 9, 4, 12, 0, 0)
        aware = _to_utc(naive)
        assert aware.tzinfo == timezone.utc
        assert _to_utc(None) is None


from app.api.outages import _to_utc as outage_to_utc


class TestOutageHandling:
    def test_outage_to_utc(self):
        dt = datetime(2026, 9, 4, 10, 0, 0)
        converted = outage_to_utc(dt)
        assert converted.tzinfo == timezone.utc

    def test_engine_suppression_window(self):
        engine = LocalizationEngine()
        now = datetime.now(timezone.utc)
        # Register active outage for DT D-0001
        engine.active_outages["D-0001"] = {
            "scope": "dt",
            "target_id": "D-0001",
            "scheduled_start": now - timedelta(minutes=10),
            "grace_end": now + timedelta(minutes=30),
        }
        assert engine._is_outage_suppressed("D-0001", "F-01-01") is True
        assert engine._is_outage_suppressed("D-9999", "F-01-01") is False


