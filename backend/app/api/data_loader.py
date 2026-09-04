"""Data loading API — CSV upload for pole and DT registries."""
import io
import csv
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from app.models.database import get_db
from app.models.schemas import Pole, DistributionTransformer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/data", tags=["data"])

# Required columns for CSVs
POLE_REQUIRED = {"pole_id", "lat", "lon", "feeder_id", "dt_id"}
DT_REQUIRED = {"dt_id", "feeder_id", "lat", "lon"}


def _validate_csv_rows(rows: list[dict], required_cols: set, entity: str) -> dict:
    """Validate CSV rows and return a validation report."""
    warnings = []
    valid_rows = []
    invalid_rows = []
    seen_ids = set()

    id_col = "pole_id" if entity == "pole" else "dt_id"

    for i, row in enumerate(rows, 1):
        errors = []
        # Check required columns
        for col in required_cols:
            if col not in row or not row[col].strip():
                errors.append(f"Missing required column: {col}")

        if not errors:
            # Validate lat/lon range (India: 8-37°N, 68-97°E)
            try:
                lat = float(row["lat"])
                lon = float(row["lon"])
                if not (6.0 <= lat <= 38.0):
                    warnings.append(f"Row {i}: lat {lat} outside India range (6-38°N)")
                if not (66.0 <= lon <= 98.0):
                    warnings.append(f"Row {i}: lon {lon} outside India range (66-98°E)")
            except ValueError:
                errors.append(f"Invalid lat/lon values")

            # Check duplicates
            entity_id = row.get(id_col, "").strip()
            if entity_id in seen_ids:
                warnings.append(f"Row {i}: Duplicate {id_col}: {entity_id}")
            seen_ids.add(entity_id)

        if errors:
            invalid_rows.append({"row": i, "errors": errors})
        else:
            valid_rows.append(row)

    # Data quality checks
    if entity == "pole":
        missing_topo = sum(1 for r in valid_rows if not r.get("parent_pole_id", "").strip())
        missing_device = sum(1 for r in valid_rows if not r.get("device_id", "").strip())
        missing_pincode = sum(1 for r in valid_rows if not r.get("pincode", "").strip())
        warnings.append(f"Topology coverage: {len(valid_rows) - missing_topo}/{len(valid_rows)} poles have parent_pole_id ({round((len(valid_rows) - missing_topo) / max(len(valid_rows), 1) * 100, 1)}%)")
        warnings.append(f"Device coverage: {len(valid_rows) - missing_device}/{len(valid_rows)} poles have devices ({round((len(valid_rows) - missing_device) / max(len(valid_rows), 1) * 100, 1)}%)")
        warnings.append(f"Pincode coverage: {len(valid_rows) - missing_pincode}/{len(valid_rows)} poles have pincode ({round((len(valid_rows) - missing_pincode) / max(len(valid_rows), 1) * 100, 1)}%)")

    return {
        "entity": entity,
        "total_rows": len(rows),
        "valid_rows": len(valid_rows),
        "invalid_rows": len(invalid_rows),
        "invalid_details": invalid_rows[:20],  # Cap at 20
        "warnings": warnings,
        "data": valid_rows,
    }


@router.post("/upload/poles")
async def upload_poles_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload a pole registry CSV file. Validates and reports data quality."""
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    # Check required columns exist in header
    header = set(rows[0].keys())
    missing = POLE_REQUIRED - header
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(sorted(missing))}. Required: {', '.join(sorted(POLE_REQUIRED))}"
        )

    report = _validate_csv_rows(rows, POLE_REQUIRED, "pole")

    # Don't auto-insert — just validate and report
    # User must call /api/data/reload to actually rebuild
    del report["data"]

    return {
        "status": "validated",
        "filename": file.filename,
        **report,
        "next_step": "Call POST /api/data/reload to rebuild network topology from uploaded data",
    }


@router.post("/upload/dts")
async def upload_dts_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload a DT registry CSV file. Validates and reports data quality."""
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    if not rows:
        raise HTTPException(status_code=400, detail="CSV file is empty")

    header = set(rows[0].keys())
    missing = DT_REQUIRED - header
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(sorted(missing))}. Required: {', '.join(sorted(DT_REQUIRED))}"
        )

    report = _validate_csv_rows(rows, DT_REQUIRED, "dt")
    del report["data"]

    return {
        "status": "validated",
        "filename": file.filename,
        **report,
    }


@router.post("/reload")
async def reload_network(db: AsyncSession = Depends(get_db)):
    """Trigger full topology rebuild from current database data."""
    from app.main import app_state, initialize_engine
    from app.core.simulator import Simulator
    from app.core.ticket_manager import TicketManager

    try:
        new_engine = await initialize_engine()
        app_state["engine"] = new_engine
        app_state["simulator"] = Simulator(new_engine)
        app_state["ticket_manager"] = TicketManager(new_engine)

        return {
            "status": "reloaded",
            "poles": len(new_engine.pole_states),
            "graph_nodes": new_engine.network_graph.number_of_nodes() if new_engine.network_graph else 0,
            "graph_edges": new_engine.network_graph.number_of_edges() if new_engine.network_graph else 0,
        }
    except Exception as e:
        logger.exception("Failed to reload network")
        raise HTTPException(status_code=500, detail=f"Reload failed: {str(e)}")


@router.get("/status")
async def data_status(db: AsyncSession = Depends(get_db)):
    """Current data quality and source information."""
    from app.main import app_state

    # Count poles
    result = await db.execute(select(func.count()).select_from(Pole))
    total_poles = result.scalar() or 0

    # Count DTs
    result = await db.execute(select(func.count()).select_from(DistributionTransformer))
    total_dts = result.scalar() or 0

    # Count poles with devices
    result = await db.execute(
        select(func.count()).select_from(Pole).where(Pole.device_id.isnot(None))
    )
    poles_with_device = result.scalar() or 0

    # Count poles with topology
    result = await db.execute(
        select(func.count()).select_from(Pole).where(Pole.parent_pole_id.isnot(None))
    )
    poles_with_topo = result.scalar() or 0

    # Count surveyed DTs
    result = await db.execute(
        select(func.count()).select_from(DistributionTransformer).where(
            DistributionTransformer.has_surveyed_topology == True
        )
    )
    surveyed_dts = result.scalar() or 0

    engine = app_state.get("engine")
    graph_built = engine is not None and engine.network_graph is not None

    return {
        "data_source": "seeded" if total_poles > 0 else "empty",
        "total_poles": total_poles,
        "total_dts": total_dts,
        "device_coverage_pct": round(poles_with_device / max(total_poles, 1) * 100, 1),
        "topology_coverage_pct": round(poles_with_topo / max(total_poles, 1) * 100, 1),
        "surveyed_dts_pct": round(surveyed_dts / max(total_dts, 1) * 100, 1),
        "graph_built": graph_built,
        "graph_nodes": engine.network_graph.number_of_nodes() if graph_built else 0,
        "graph_edges": engine.network_graph.number_of_edges() if graph_built else 0,
    }
