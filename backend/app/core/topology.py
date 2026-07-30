"""
Topology inference and network graph construction.

Handles two cases:
- Surveyed topology (40%): build tree directly from parent_pole_id
- Missing topology (60%): infer tree via GPS-based greedy DT-outward growth

See design doc §1 for algorithm details and failure modes.
"""
import math
import logging
from dataclasses import dataclass
from typing import Optional
import networkx as nx
import numpy as np
from scipy.spatial import KDTree

logger = logging.getLogger(__name__)

# Approximate meters per degree at Bangalore's latitude
METERS_PER_DEG_LAT = 111_320
METERS_PER_DEG_LON = 111_320 * math.cos(math.radians(12.97))


@dataclass
class PoleInfo:
    """Lightweight pole data for graph construction."""
    pole_id: str
    lat: float
    lon: float
    dt_id: str
    feeder_id: str
    device_id: Optional[str]
    parent_pole_id: Optional[str]
    seq_on_line: Optional[int]
    pincode: Optional[str]
    ward: Optional[str]
    topology_source: str
    topology_confidence: str
    fw_version: Optional[str] = None


@dataclass
class DTInfo:
    """Lightweight DT data for graph construction."""
    dt_id: str
    feeder_id: str
    lat: float
    lon: float
    has_surveyed_topology: bool
    households_served: int = 0


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate distance in meters between two GPS points."""
    dlat = (lat2 - lat1) * METERS_PER_DEG_LAT
    dlon = (lon2 - lon1) * METERS_PER_DEG_LON
    return math.sqrt(dlat * dlat + dlon * dlon)


def _compute_angle(p1_lat, p1_lon, p2_lat, p2_lon, p3_lat, p3_lon) -> float:
    """Compute angle at p2 in the path p1->p2->p3, in degrees."""
    v1 = ((p1_lat - p2_lat) * METERS_PER_DEG_LAT,
          (p1_lon - p2_lon) * METERS_PER_DEG_LON)
    v2 = ((p3_lat - p2_lat) * METERS_PER_DEG_LAT,
          (p3_lon - p2_lon) * METERS_PER_DEG_LON)
    dot = v1[0] * v2[0] + v1[1] * v2[1]
    mag1 = math.sqrt(v1[0]**2 + v1[1]**2)
    mag2 = math.sqrt(v2[0]**2 + v2[1]**2)
    if mag1 < 1e-9 or mag2 < 1e-9:
        return 180.0
    cos_angle = max(-1.0, min(1.0, dot / (mag1 * mag2)))
    return math.degrees(math.acos(cos_angle))


def infer_topology_for_dt(
    dt: DTInfo,
    poles: list[PoleInfo],
) -> list[tuple[str, str, str]]:
    """
    Infer pole ordering for a DT with missing topology using GPS-based
    greedy tree construction (Prim's-like, rooted at DT).

    Returns list of (parent_pole_id, child_pole_id, confidence) tuples.
    confidence is "HIGH", "MEDIUM", or "LOW".
    """
    if not poles:
        return []

    # Compute adaptive distance threshold: mean nearest-neighbour distance + 3σ
    coords = np.array([[p.lat * METERS_PER_DEG_LAT, p.lon * METERS_PER_DEG_LON] for p in poles])
    dt_coord = np.array([dt.lat * METERS_PER_DEG_LAT, dt.lon * METERS_PER_DEG_LON])

    if len(poles) == 1:
        return [(dt.dt_id, poles[0].pole_id, "MEDIUM")]

    # KD-tree for nearest-neighbour lookups
    tree = KDTree(coords)
    nn_dists, _ = tree.query(coords, k=2)  # k=2 because nearest to self is 0
    nn_dists = nn_dists[:, 1]  # second column = nearest non-self neighbour

    mean_dist = float(np.mean(nn_dists))
    std_dist = float(np.std(nn_dists))
    threshold = mean_dist + 3 * std_dist
    threshold = max(threshold, 80.0)  # floor at 80m to avoid overly tight thresholds for dense areas

    logger.debug(f"DT {dt.dt_id}: {len(poles)} poles, mean_nn={mean_dist:.1f}m, "
                 f"std={std_dist:.1f}m, threshold={threshold:.1f}m")

    # Build pole lookup
    pole_by_id = {p.pole_id: p for p in poles}
    pole_ids = [p.pole_id for p in poles]

    # Start from DT: find nearest pole to DT
    dt_dists = np.sqrt(np.sum((coords - dt_coord) ** 2, axis=1))
    first_idx = int(np.argmin(dt_dists))

    assigned = set()
    edges = []

    # Assign first pole to DT
    first_pole = poles[first_idx]
    first_dist = float(dt_dists[first_idx])
    edges.append((dt.dt_id, first_pole.pole_id,
                  "HIGH" if first_dist < mean_dist else "MEDIUM"))
    assigned.add(first_idx)

    # Frontier: set of assigned pole indices
    frontier = {first_idx}

    # Iteratively grow the tree (Prim's-like)
    while len(assigned) < len(poles):
        best_edge = None
        best_dist = float('inf')
        best_confidence = "LOW"

        for f_idx in list(frontier):
            # Find nearest unassigned poles to this frontier node
            dists_from_f = np.sqrt(np.sum((coords - coords[f_idx]) ** 2, axis=1))

            for candidate_idx in np.argsort(dists_from_f):
                if candidate_idx in assigned:
                    continue
                dist = float(dists_from_f[candidate_idx])
                if dist > threshold:
                    break  # sorted, so all remaining are farther
                if dist < best_dist:
                    # Compute directional confidence penalty
                    confidence = "HIGH" if dist < mean_dist else "MEDIUM"

                    # Check angle if frontier node has a parent
                    f_pole = poles[f_idx]
                    c_pole = poles[candidate_idx]
                    parent_edge = [e for e in edges if e[1] == f_pole.pole_id]
                    if parent_edge:
                        parent_id = parent_edge[0][0]
                        if parent_id != dt.dt_id and parent_id in pole_by_id:
                            parent_pole = pole_by_id[parent_id]
                            angle = _compute_angle(
                                parent_pole.lat, parent_pole.lon,
                                f_pole.lat, f_pole.lon,
                                c_pole.lat, c_pole.lon
                            )
                            # Soft penalty: sharp doubling-back reduces confidence
                            if angle < 45:
                                confidence = "LOW"

                    best_edge = (f_idx, candidate_idx)
                    best_dist = dist
                    best_confidence = confidence

        if best_edge is None:
            # Remaining poles are too far from any frontier node
            # Force-attach them to nearest assigned pole with LOW confidence
            for idx in range(len(poles)):
                if idx not in assigned:
                    dists_all = np.sqrt(np.sum((coords - coords[idx]) ** 2, axis=1))
                    for near_idx in np.argsort(dists_all):
                        if near_idx in assigned:
                            edges.append((poles[near_idx].pole_id, poles[idx].pole_id, "LOW"))
                            assigned.add(idx)
                            break
            break

        parent_idx, child_idx = best_edge
        parent_pole_id = poles[parent_idx].pole_id
        child_pole_id = poles[child_idx].pole_id
        edges.append((parent_pole_id, child_pole_id, best_confidence))
        assigned.add(child_idx)
        frontier.add(child_idx)

        # Remove frontier nodes with no more reachable unassigned neighbours
        # (optimization: skip for small DTs)

    logger.info(f"DT {dt.dt_id}: inferred {len(edges)} edges for {len(poles)} poles")
    return edges


def build_network_graph(
    poles: list[PoleInfo],
    dts: list[DTInfo],
    feeders: list[dict],
    substations: list[dict],
) -> tuple[nx.DiGraph, dict[str, nx.DiGraph]]:
    """
    Build the complete network graph and per-DT subtrees.

    For DTs with surveyed topology: use parent_pole_id directly.
    For DTs with missing topology: run GPS-based inference.

    Returns:
        (full_graph, dt_trees) where dt_trees maps dt_id → rooted subtree
    """
    G = nx.DiGraph()

    # Add substations
    for sub in substations:
        G.add_node(sub["substation_id"], node_type="substation",
                   lat=sub.get("lat"), lon=sub.get("lon"))

    # Add feeders
    for f in feeders:
        G.add_node(f["feeder_id"], node_type="feeder",
                   substation_id=f["substation_id"])
        G.add_edge(f["substation_id"], f["feeder_id"], edge_type="feeder")

    # Group poles by DT
    dt_poles: dict[str, list[PoleInfo]] = {}
    for p in poles:
        dt_poles.setdefault(p.dt_id, []).append(p)

    dt_by_id = {d.dt_id: d for d in dts}

    # Process each DT
    inferred_count = 0
    surveyed_count = 0

    for dt in dts:
        G.add_node(dt.dt_id, node_type="dt", lat=dt.lat, lon=dt.lon,
                   feeder_id=dt.feeder_id, households_served=dt.households_served,
                   has_surveyed_topology=dt.has_surveyed_topology)
        G.add_edge(dt.feeder_id, dt.dt_id, edge_type="dt")

        dt_pole_list = dt_poles.get(dt.dt_id, [])
        if not dt_pole_list:
            continue

        if dt.has_surveyed_topology:
            # Surveyed: use parent_pole_id directly
            surveyed_count += 1
            for p in dt_pole_list:
                G.add_node(p.pole_id, node_type="pole", lat=p.lat, lon=p.lon,
                           dt_id=p.dt_id, feeder_id=p.feeder_id,
                           device_id=p.device_id, pincode=p.pincode,
                           ward=p.ward, topology_source="surveyed",
                           topology_confidence="HIGH",
                           fw_version=p.fw_version)
                if p.parent_pole_id:
                    G.add_edge(p.parent_pole_id, p.pole_id,
                               edge_type="span", topology_source="surveyed",
                               topology_confidence="HIGH")
                else:
                    # Root pole: connect to DT
                    G.add_edge(dt.dt_id, p.pole_id,
                               edge_type="span", topology_source="surveyed",
                               topology_confidence="HIGH")
        else:
            # Missing topology: infer from GPS
            inferred_count += 1
            for p in dt_pole_list:
                G.add_node(p.pole_id, node_type="pole", lat=p.lat, lon=p.lon,
                           dt_id=p.dt_id, feeder_id=p.feeder_id,
                           device_id=p.device_id, pincode=p.pincode,
                           ward=p.ward, topology_source="inferred_gps",
                           topology_confidence="MEDIUM",
                           fw_version=p.fw_version)

            inferred_edges = infer_topology_for_dt(dt, dt_pole_list)
            for parent_id, child_id, confidence in inferred_edges:
                G.add_edge(parent_id, child_id,
                           edge_type="span", topology_source="inferred_gps",
                           topology_confidence=confidence)

    logger.info(f"Network graph built: {G.number_of_nodes()} nodes, "
                f"{G.number_of_edges()} edges. "
                f"Surveyed DTs: {surveyed_count}, Inferred DTs: {inferred_count}")

    # Build per-DT subtrees for fast localization
    dt_trees = {}
    for dt in dts:
        dt_pole_ids = [p.pole_id for p in dt_poles.get(dt.dt_id, [])]
        if not dt_pole_ids:
            continue
        sub_nodes = [dt.dt_id] + dt_pole_ids
        dt_trees[dt.dt_id] = G.subgraph(sub_nodes).copy()

    return G, dt_trees
