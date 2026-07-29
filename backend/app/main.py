"""
Main FastAPI application.

Startup sequence:
1. Create database tables
2. Generate and seed synthetic network (if empty)
3. Run topology inference for DTs with missing ordering
4. Initialize localization engine with network graph
5. Start periodic detection sweep (10s interval)
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, select, func

from app.config import settings
from app.models.database import engine as db_engine, async_session, Base
from app.models.schemas import (
    Pole, DistributionTransformer, Feeder, Substation, PoleState as PoleStateModel
)
from app.core.topology import build_network_graph, PoleInfo, DTInfo
from app.core.localization import LocalizationEngine
from app.core.ticket_manager import TicketManager
from app.core.simulator import FaultSimulator
from app.api import telemetry, tickets, simulator, events, ai
from app.api.events import broadcast_event

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Global app state — shared across requests and background tasks
app_state: dict = {}


async def seed_database():
    """Seed the database with synthetic network data if empty."""
    async with async_session() as session:
        result = await session.execute(select(func.count()).select_from(Pole))
        count = result.scalar()
        if count and count > 0:
            logger.info(f"Database already seeded with {count} poles, skipping")
            return

    logger.info("Seeding database with synthetic network...")
    from app.seed.generator import generate_network

    net = generate_network()

    async with async_session() as session:
        # Insert substations
        for sub in net.substations:
            session.add(Substation(
                substation_id=sub.substation_id,
                lat=sub.lat, lon=sub.lon,
            ))

        # Insert feeders
        for f in net.feeders:
            session.add(Feeder(
                feeder_id=f.feeder_id,
                substation_id=f.substation_id,
            ))

        # Insert DTs
        for dt in net.transformers:
            session.add(DistributionTransformer(
                dt_id=dt.dt_id,
                feeder_id=dt.feeder_id,
                lat=dt.lat, lon=dt.lon,
                capacity_kva=dt.capacity_kva,
                households_served=dt.households_served,
                has_surveyed_topology=dt.has_surveyed_topology,
            ))

        await session.flush()

        # Insert poles
        for p in net.poles:
            session.add(Pole(
                pole_id=p.pole_id,
                lat=p.lat, lon=p.lon,
                feeder_id=p.feeder_id,
                dt_id=p.dt_id,
                seq_on_line=p.seq_on_line,
                parent_pole_id=p.parent_pole_id,
                pole_type=p.pole_type,
                ward=p.ward,
                pincode=p.pincode,
                device_id=p.device_id,
                topology_source=p.topology_source,
                topology_confidence=p.topology_confidence,
            ))

        # Initialize pole states
        for p in net.poles:
            session.add(PoleStateModel(
                pole_id=p.pole_id,
                status="live" if p.device_id else "unknown",
                fw_version=p.fw_version,
            ))

        await session.commit()

    logger.info(f"Seeded: {len(net.substations)} substations, {len(net.feeders)} feeders, "
                f"{len(net.transformers)} DTs, {len(net.poles)} poles")


async def initialize_engine():
    """Load network from DB, build graph, initialize localization engine."""
    engine = LocalizationEngine()

    async with async_session() as session:
        # Load all poles
        result = await session.execute(select(Pole))
        poles_db = result.scalars().all()

        poles = [PoleInfo(
            pole_id=p.pole_id, lat=p.lat, lon=p.lon,
            dt_id=p.dt_id, feeder_id=p.feeder_id,
            device_id=p.device_id, parent_pole_id=p.parent_pole_id,
            seq_on_line=p.seq_on_line, pincode=p.pincode, ward=p.ward,
            topology_source=p.topology_source,
            topology_confidence=p.topology_confidence or "MEDIUM",
        ) for p in poles_db]

        # Load DTs
        result = await session.execute(select(DistributionTransformer))
        dts_db = result.scalars().all()
        dts = [DTInfo(
            dt_id=d.dt_id, feeder_id=d.feeder_id,
            lat=d.lat, lon=d.lon,
            has_surveyed_topology=d.has_surveyed_topology,
            households_served=d.households_served or 0,
        ) for d in dts_db]

        # Load feeders
        result = await session.execute(select(Feeder))
        feeders_db = result.scalars().all()
        feeders = [{"feeder_id": f.feeder_id, "substation_id": f.substation_id}
                   for f in feeders_db]

        # Load substations
        result = await session.execute(select(Substation))
        subs_db = result.scalars().all()
        substations = [{"substation_id": s.substation_id, "lat": s.lat, "lon": s.lon}
                       for s in subs_db]

    # Build network graph (includes topology inference for missing DTs)
    logger.info("Building network graph and running topology inference...")
    graph, dt_trees = build_network_graph(poles, dts, feeders, substations)

    engine.network_graph = graph
    engine.dt_trees = dt_trees

    # Initialize pole states
    for p in poles:
        # Get fw_version from graph node data
        fw = graph.nodes[p.pole_id].get("fw_version") if p.pole_id in graph.nodes else None
        engine.init_pole_state(
            pole_id=p.pole_id,
            device_id=p.device_id,
            dt_id=p.dt_id,
            feeder_id=p.feeder_id,
            fw_version=fw,
        )

    logger.info(f"Engine initialized: {len(engine.pole_states)} poles tracked")
    return engine


async def detection_sweep_loop(engine: LocalizationEngine, ticket_manager: TicketManager):
    """Background task: run detection sweep every 10 seconds."""
    logger.info(f"Starting detection sweep loop (interval={settings.sweep_interval_seconds}s)")

    while True:
        try:
            await asyncio.sleep(settings.sweep_interval_seconds)

            boundaries, anomalies = engine.run_sweep()

            if boundaries:
                async with async_session() as db:
                    for boundary in boundaries:
                        # Check if this boundary already has a ticket
                        if await ticket_manager.is_duplicate_boundary(boundary):
                            continue
                        ticket_data = await ticket_manager.create_ticket_from_boundary(boundary, db)
                        if ticket_data:
                            await broadcast_event("ticket_created", ticket_data)

            if anomalies:
                for anomaly in anomalies:
                    logger.info(f"Device anomaly: {anomaly.pole_id} ({anomaly.reason})")
                    await broadcast_event("device_anomaly", {
                        "pole_id": anomaly.pole_id,
                        "dt_id": anomaly.dt_id,
                        "reason": anomaly.reason,
                    })

            # Check for restoration / auto-verification
            async with async_session() as db:
                verified = await ticket_manager.check_restoration(db)
                for display_id in verified:
                    await broadcast_event("ticket_verified", {"display_id": display_id})

        except asyncio.CancelledError:
            logger.info("Detection sweep loop cancelled")
            break
        except Exception as e:
            logger.error(f"Error in detection sweep: {e}", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: startup and shutdown."""
    # --- Startup ---
    logger.info("Starting Fault Localization System...")

    # Create tables
    async with db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created")

    # Seed if empty
    await seed_database()

    # Initialize localization engine
    loc_engine = await initialize_engine()
    ticket_mgr = TicketManager(loc_engine)
    sim = FaultSimulator(loc_engine)

    # Wire up SSE broadcasting
    ticket_mgr.on_ticket_event = broadcast_event

    # Store in global state
    app_state["engine"] = loc_engine
    app_state["ticket_manager"] = ticket_mgr
    app_state["simulator"] = sim

    # Start detection sweep background task
    sweep_task = asyncio.create_task(detection_sweep_loop(loc_engine, ticket_mgr))

    logger.info("System ready. Operator console available at the frontend URL.")

    yield

    # --- Shutdown ---
    sweep_task.cancel()
    try:
        await sweep_task
    except asyncio.CancelledError:
        pass
    await db_engine.dispose()
    logger.info("System shut down cleanly")


# Create the FastAPI app
app = FastAPI(
    title="Fault Localization System",
    description="Power distribution fault detection, localization, and ticketing",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount API routers
app.include_router(telemetry.router)
app.include_router(tickets.router)
app.include_router(simulator.router)
app.include_router(events.router)
app.include_router(ai.router)


@app.get("/api/health")
async def health():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "engine_initialized": "engine" in app_state,
        "poles_tracked": len(app_state.get("engine", LocalizationEngine()).pole_states),
    }
