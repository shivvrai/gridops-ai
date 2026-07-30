"""
Synthetic registry generator for the fault localization system.

Generates a realistic radial distribution network:
- 4 substations, ~31 feeders, ~412 DTs, ~3,800 poles (scaled down from 38,400)
- 60% of DTs have missing topology (no seq_on_line, no parent_pole_id)
- ~9% of poles have no device
- ~3% of poles have no pincode
- Firmware distribution: ~8% on 1.2.x, rest on 1.3+ 
- Realistic GPS coordinates centered around Bangalore (~12.97°N, 77.59°E)
"""
import random
import math
from dataclasses import dataclass, field
from typing import Optional


# Bangalore-area center coordinates
BASE_LAT = 12.9716
BASE_LON = 77.5946

# Approximate meters per degree at Bangalore's latitude
METERS_PER_DEG_LAT = 111_320
METERS_PER_DEG_LON = 111_320 * math.cos(math.radians(BASE_LAT))

# Ward/pincode pools
WARDS = [f"W-{i:03d}" for i in range(80, 120)]
PINCODES = ["560078", "560079", "560080", "560085", "560086",
            "560041", "560043", "560047", "560050", "560056"]
FW_VERSIONS = ["1.2.3", "1.2.5", "1.3.0", "1.3.1", "1.4.0", "1.4.1", "1.4.2"]
FW_WEIGHTS = [4, 4, 10, 10, 25, 25, 22]  # ~8% on 1.2.x
POLE_TYPES = ["LT-9m-PCC", "LT-8m-Steel", "LT-9m-Steel", "LT-11m-PCC"]


def _meters_to_deg_lat(m: float) -> float:
    return m / METERS_PER_DEG_LAT


def _meters_to_deg_lon(m: float) -> float:
    return m / METERS_PER_DEG_LON


@dataclass
class SubstationData:
    substation_id: str
    lat: float
    lon: float


@dataclass
class FeederData:
    feeder_id: str
    substation_id: str


@dataclass
class DTData:
    dt_id: str
    feeder_id: str
    lat: float
    lon: float
    capacity_kva: int
    households_served: int
    has_surveyed_topology: bool


@dataclass
class PoleData:
    pole_id: str
    lat: float
    lon: float
    feeder_id: str
    dt_id: str
    seq_on_line: Optional[int]
    parent_pole_id: Optional[str]
    pole_type: str
    ward: str
    pincode: Optional[str]
    device_id: Optional[str]
    topology_source: str
    topology_confidence: str
    fw_version: Optional[str] = None  # set if device_id is present


@dataclass
class GeneratedNetwork:
    substations: list[SubstationData] = field(default_factory=list)
    feeders: list[FeederData] = field(default_factory=list)
    transformers: list[DTData] = field(default_factory=list)
    poles: list[PoleData] = field(default_factory=list)


def generate_network(
    num_substations: int = 4,
    feeders_per_sub: tuple[int, int] = (6, 10),
    dts_per_feeder: tuple[int, int] = (8, 18),
    poles_per_dt: tuple[int, int] = (15, 90),
    missing_topo_ratio: float = 0.60,
    no_device_ratio: float = 0.09,
    no_pincode_ratio: float = 0.03,
    seed: int = 42,
) -> GeneratedNetwork:
    """Generate a complete synthetic distribution network."""
    rng = random.Random(seed)
    net = GeneratedNetwork()

    pole_counter = 0
    dt_counter = 0
    feeder_counter = 0

    # Generate substations spread around the base area
    for si in range(num_substations):
        angle = 2 * math.pi * si / num_substations
        radius_m = rng.uniform(800, 2000)
        sub = SubstationData(
            substation_id=f"SS-{si+1:02d}",
            lat=BASE_LAT + _meters_to_deg_lat(radius_m * math.sin(angle)),
            lon=BASE_LON + _meters_to_deg_lon(radius_m * math.cos(angle)),
        )
        net.substations.append(sub)

        # Feeders per substation
        n_feeders = rng.randint(*feeders_per_sub)
        for fi in range(n_feeders):
            feeder_counter += 1
            feeder = FeederData(
                feeder_id=f"F-{si+1:02d}-{fi+1:02d}",
                substation_id=sub.substation_id,
            )
            net.feeders.append(feeder)

            # DTs per feeder
            n_dts = rng.randint(*dts_per_feeder)
            for di in range(n_dts):
                dt_counter += 1
                has_topo = rng.random() > missing_topo_ratio

                # DT location: spread along the feeder direction
                feeder_angle = 2 * math.pi * fi / n_feeders + rng.uniform(-0.3, 0.3)
                dt_radius_m = rng.uniform(200, 1400)
                dt = DTData(
                    dt_id=f"D-{dt_counter:04d}",
                    feeder_id=feeder.feeder_id,
                    lat=sub.lat + _meters_to_deg_lat(dt_radius_m * math.sin(feeder_angle) + rng.uniform(-50, 50)),
                    lon=sub.lon + _meters_to_deg_lon(dt_radius_m * math.cos(feeder_angle) + rng.uniform(-50, 50)),
                    capacity_kva=rng.choice([100, 250, 500, 630]),
                    households_served=rng.randint(30, 500),
                    has_surveyed_topology=has_topo,
                )
                net.transformers.append(dt)

                # Generate poles along LT lines from this DT
                n_poles = rng.randint(*poles_per_dt)
                ward = rng.choice(WARDS)
                pincode = rng.choice(PINCODES)

                # Generate a realistic tree of poles:
                # Main trunk + 1-3 branches
                n_branches = rng.randint(1, min(3, max(1, n_poles // 10)))
                branch_points = sorted(rng.sample(range(3, n_poles - 2), min(n_branches, n_poles - 5))) if n_poles > 7 else []

                # Walk direction for the main trunk
                trunk_angle = rng.uniform(0, 2 * math.pi)
                span_length_m = rng.uniform(30, 50)  # typical pole spacing

                dt_poles = []
                parent_map = {}  # seq -> pole_id for building parent references

                # Main trunk
                cur_lat = dt.lat
                cur_lon = dt.lon
                seq = 0
                trunk_pole_ids = []

                for pi in range(n_poles):
                    pole_counter += 1
                    seq += 1
                    pole_id = f"P-{pole_counter:06d}"

                    # Move along the trunk with slight random deviation
                    step = rng.uniform(span_length_m * 0.8, span_length_m * 1.2)
                    angle_jitter = rng.uniform(-0.15, 0.15)
                    cur_lat += _meters_to_deg_lat(step * math.sin(trunk_angle + angle_jitter))
                    cur_lon += _meters_to_deg_lon(step * math.cos(trunk_angle + angle_jitter))

                    # GPS noise ±4m
                    plat = cur_lat + _meters_to_deg_lat(rng.uniform(-4, 4))
                    plon = cur_lon + _meters_to_deg_lon(rng.uniform(-4, 4))

                    # Device assignment (~9% no device)
                    has_device = rng.random() > no_device_ratio
                    device_id = f"KSPDB-{sub.substation_id}-{dt.dt_id}-{pole_counter:04d}" if has_device else None
                    fw = rng.choices(FW_VERSIONS, weights=FW_WEIGHTS, k=1)[0] if has_device else None

                    # Pincode (~3% missing)
                    p_pincode = pincode if rng.random() > no_pincode_ratio else None

                    # Parent pole
                    if seq == 1:
                        parent_id = None  # first pole connects to DT
                    else:
                        parent_id = trunk_pole_ids[-1]

                    pole = PoleData(
                        pole_id=pole_id,
                        lat=plat,
                        lon=plon,
                        feeder_id=feeder.feeder_id,
                        dt_id=dt.dt_id,
                        seq_on_line=seq if has_topo else None,
                        parent_pole_id=parent_id if has_topo else None,
                        pole_type=rng.choice(POLE_TYPES),
                        ward=ward,
                        pincode=p_pincode,
                        device_id=device_id,
                        topology_source="surveyed" if has_topo else "unknown",
                        topology_confidence="HIGH" if has_topo else "MEDIUM",
                        fw_version=fw,
                    )
                    dt_poles.append(pole)
                    trunk_pole_ids.append(pole_id)
                    parent_map[seq] = pole_id

                    # Check if this is a branch point
                    if pi in branch_points:
                        # Generate a spur branch (3-10 poles)
                        branch_len = rng.randint(3, min(10, max(3, (n_poles - pi) // 2)))
                        branch_angle = trunk_angle + rng.choice([-1, 1]) * rng.uniform(0.5, 1.2)
                        br_lat, br_lon = plat, plon

                        for bi in range(branch_len):
                            pole_counter += 1
                            seq += 1
                            br_pole_id = f"P-{pole_counter:06d}"

                            br_step = rng.uniform(span_length_m * 0.8, span_length_m * 1.2)
                            br_lat += _meters_to_deg_lat(br_step * math.sin(branch_angle + rng.uniform(-0.1, 0.1)))
                            br_lon += _meters_to_deg_lon(br_step * math.cos(branch_angle + rng.uniform(-0.1, 0.1)))

                            br_plat = br_lat + _meters_to_deg_lat(rng.uniform(-4, 4))
                            br_plon = br_lon + _meters_to_deg_lon(rng.uniform(-4, 4))

                            br_has_device = rng.random() > no_device_ratio
                            br_device_id = f"KSPDB-{sub.substation_id}-{dt.dt_id}-{pole_counter:04d}" if br_has_device else None
                            br_fw = rng.choices(FW_VERSIONS, weights=FW_WEIGHTS, k=1)[0] if br_has_device else None
                            br_pincode = pincode if rng.random() > no_pincode_ratio else None

                            if bi == 0:
                                br_parent = pole_id  # branch starts from trunk pole
                            else:
                                br_parent = dt_poles[-1].pole_id

                            br_pole = PoleData(
                                pole_id=br_pole_id,
                                lat=br_plat,
                                lon=br_plon,
                                feeder_id=feeder.feeder_id,
                                dt_id=dt.dt_id,
                                seq_on_line=seq if has_topo else None,
                                parent_pole_id=br_parent if has_topo else None,
                                pole_type=rng.choice(POLE_TYPES),
                                ward=ward,
                                pincode=br_pincode,
                                device_id=br_device_id,
                                topology_source="surveyed" if has_topo else "unknown",
                                topology_confidence="HIGH" if has_topo else "MEDIUM",
                                fw_version=br_fw,
                            )
                            dt_poles.append(br_pole)
                            parent_map[seq] = br_pole_id

                net.poles.extend(dt_poles)

    return net
