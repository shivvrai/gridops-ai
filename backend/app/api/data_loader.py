"""Data loading API — CSV upload for pole and DT registries."""
import io
import csv
import logging
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete

from fastapi.responses import Response
from app.models.database import get_db
from app.models.schemas import Pole, DistributionTransformer, Feeder, Substation

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


@router.get("/template/poles")
async def download_poles_template():
    """Return a sample CSV template for poles registry."""
    csv_content = (
        "pole_id,lat,lon,feeder_id,dt_id,seq_on_line,parent_pole_id,pole_type,ward,pincode,device_id\n"
        "P-024431,12.968214,77.594612,F-07-03,D-0112,1,D-0112,LT-9m-PCC,W-084,560078,KSPDB-SD07-D0112-4431\n"
        "P-024432,12.968901,77.594330,F-07-03,D-0112,2,P-024431,LT-9m-PCC,W-084,560078,KSPDB-SD07-D0112-4432\n"
        "P-024433,12.969455,77.593980,F-07-03,D-0112,,,LT-8m-Steel,W-084,560078,\n"
    )
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=poles_template.csv"}
    )


@router.get("/template/dts")
async def download_dts_template():
    """Return a sample CSV template for distribution transformers registry."""
    csv_content = (
        "dt_id,feeder_id,lat,lon,capacity_kva,households_served,has_surveyed_topology\n"
        "D-0112,F-07-03,12.967801,77.595120,250,318,true\n"
        "D-0113,F-07-03,12.968500,77.596000,100,145,false\n"
    )
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=dts_template.csv"}
    )


@router.post("/upload/poles")
async def upload_poles_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload a pole registry CSV file. Validates, upserts to DB, and reports data quality."""
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
    valid_data = report.pop("data")

    # Upsert valid poles into database
    if valid_data:
        for r in valid_data:
            pole_id = r["pole_id"].strip()
            feeder_id = r["feeder_id"].strip()
            dt_id = r["dt_id"].strip()

            # Ensure feeder exists
            feeder = await db.get(Feeder, feeder_id)
            if not feeder:
                sub = await db.execute(select(Substation).limit(1))
                sub_obj = sub.scalars().first()
                sub_id = sub_obj.substation_id if sub_obj else "SUB-01"
                if not sub_obj:
                    db.add(Substation(substation_id=sub_id, lat=float(r["lat"]), lon=float(r["lon"])))
                    await db.flush()
                db.add(Feeder(feeder_id=feeder_id, substation_id=sub_id))
                await db.flush()

            # Ensure DT exists
            dt = await db.get(DistributionTransformer, dt_id)
            if not dt:
                db.add(DistributionTransformer(
                    dt_id=dt_id, feeder_id=feeder_id,
                    lat=float(r["lat"]), lon=float(r["lon"]),
                    has_surveyed_topology=bool(r.get("parent_pole_id", "").strip())
                ))
                await db.flush()

            parent_id = r.get("parent_pole_id", "").strip() or None
            seq_val = int(r["seq_on_line"]) if r.get("seq_on_line", "").strip().isdigit() else None
            pole = await db.get(Pole, pole_id)
            if pole:
                pole.lat = float(r["lat"])
                pole.lon = float(r["lon"])
                pole.feeder_id = feeder_id
                pole.dt_id = dt_id
                pole.parent_pole_id = parent_id
                pole.seq_on_line = seq_val
                pole.device_id = r.get("device_id", "").strip() or None
                pole.pincode = r.get("pincode", "").strip() or None
                pole.ward = r.get("ward", "").strip() or None
                pole.pole_type = r.get("pole_type", "").strip() or "LT-9m-PCC"
                pole.topology_source = "surveyed" if parent_id else "unknown"
            else:
                pole = Pole(
                    pole_id=pole_id,
                    lat=float(r["lat"]),
                    lon=float(r["lon"]),
                    feeder_id=feeder_id,
                    dt_id=dt_id,
                    parent_pole_id=parent_id,
                    seq_on_line=seq_val,
                    device_id=r.get("device_id", "").strip() or None,
                    pincode=r.get("pincode", "").strip() or None,
                    ward=r.get("ward", "").strip() or None,
                    pole_type=r.get("pole_type", "").strip() or "LT-9m-PCC",
                    topology_source="surveyed" if parent_id else "unknown",
                )
                db.add(pole)
        await db.commit()

    return {
        "status": "validated",
        "filename": file.filename,
        "saved_to_db": len(valid_data),
        **report,
        "next_step": "Click 'Reload Network' to rebuild topology graph from new data",
    }


@router.post("/upload/dts")
async def upload_dts_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload a DT registry CSV file. Validates, upserts to DB, and reports data quality."""
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
    valid_data = report.pop("data")

    # Upsert valid DTs into database
    if valid_data:
        for r in valid_data:
            dt_id = r["dt_id"].strip()
            feeder_id = r["feeder_id"].strip()

            # Ensure feeder exists
            feeder = await db.get(Feeder, feeder_id)
            if not feeder:
                sub = await db.execute(select(Substation).limit(1))
                sub_obj = sub.scalars().first()
                sub_id = sub_obj.substation_id if sub_obj else "SUB-01"
                if not sub_obj:
                    db.add(Substation(substation_id=sub_id, lat=float(r["lat"]), lon=float(r["lon"])))
                    await db.flush()
                db.add(Feeder(feeder_id=feeder_id, substation_id=sub_id))
                await db.flush()

            dt = await db.get(DistributionTransformer, dt_id)
            cap = int(r["capacity_kva"]) if r.get("capacity_kva", "").strip().isdigit() else None
            hh = int(r["households_served"]) if r.get("households_served", "").strip().isdigit() else None
            has_surveyed = r.get("has_surveyed_topology", "").strip().lower() in ("true", "1", "yes")

            if dt:
                dt.feeder_id = feeder_id
                dt.lat = float(r["lat"])
                dt.lon = float(r["lon"])
                if cap is not None:
                    dt.capacity_kva = cap
                if hh is not None:
                    dt.households_served = hh
                if r.get("has_surveyed_topology", "").strip():
                    dt.has_surveyed_topology = has_surveyed
            else:
                dt = DistributionTransformer(
                    dt_id=dt_id,
                    feeder_id=feeder_id,
                    lat=float(r["lat"]),
                    lon=float(r["lon"]),
                    capacity_kva=cap,
                    households_served=hh,
                    has_surveyed_topology=has_surveyed,
                )
                db.add(dt)
        await db.commit()

    return {
        "status": "validated",
        "filename": file.filename,
        "saved_to_db": len(valid_data),
        **report,
        "next_step": "Click 'Reload Network' to rebuild topology graph from new data",
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


# Outage CSV requirements
OUTAGE_REQUIRED = {"outage_id", "scope", "target_id", "scheduled_start", "scheduled_end"}


@router.get("/template/outages")
async def download_outages_template():
    """Return a sample CSV template for scheduled outages feed."""
    csv_content = (
        "outage_id,scope,target_id,scheduled_start,scheduled_end,reason\n"
        "SO-2026-07-29-014,feeder,F-07-03,2026-07-29T10:00:00Z,2026-07-29T12:30:00Z,Planned maintenance - jumper replacement\n"
        "SO-2026-07-29-021,dt,D-0112,2026-07-29T14:00:00Z,2026-07-29T15:00:00Z,Load shedding\n"
    )
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=outages_template.csv"}
    )


@router.post("/upload/outages")
async def upload_outages_csv(file: UploadFile = File(...), db: AsyncSession = Depends(get_db)):
    """Upload a scheduled outages CSV file. Validates and saves to DB."""
    from datetime import datetime, timezone, timedelta
    from app.models.schemas import ScheduledOutage
    from app.config import settings

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
    missing = OUTAGE_REQUIRED - header
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required columns: {', '.join(sorted(missing))}. Required: {', '.join(sorted(OUTAGE_REQUIRED))}"
        )

    valid_rows = []
    invalid_rows = []
    warnings = []

    for i, row in enumerate(rows, 1):
        errors = []
        for col in OUTAGE_REQUIRED:
            if col not in row or not row[col].strip():
                errors.append(f"Missing required column: {col}")

        if not errors:
            scope = row["scope"].strip().lower()
            if scope not in ("feeder", "dt"):
                errors.append(f"Row {i}: Invalid scope '{scope}'. Must be 'feeder' or 'dt'.")

            try:
                start = datetime.fromisoformat(row["scheduled_start"].replace("Z", "+00:00"))
                end = datetime.fromisoformat(row["scheduled_end"].replace("Z", "+00:00"))
                if end <= start:
                    errors.append(f"Row {i}: scheduled_end must be after scheduled_start.")
            except ValueError:
                errors.append(f"Row {i}: Invalid ISO datetime format.")

        if errors:
            invalid_rows.append({"row": i, "errors": errors})
        else:
            valid_rows.append(row)

    # Upsert valid outages
    saved_count = 0
    for r in valid_rows:
        outage_id = r["outage_id"].strip()
        scope = r["scope"].strip().lower()
        target_id = r["target_id"].strip()
        start = datetime.fromisoformat(r["scheduled_start"].replace("Z", "+00:00"))
        end = datetime.fromisoformat(r["scheduled_end"].replace("Z", "+00:00"))
        grace = end + timedelta(minutes=settings.grace_period_minutes)
        reason = r.get("reason", "").strip() or "Scheduled maintenance"

        outage = await db.get(ScheduledOutage, outage_id)
        if outage:
            outage.scope = scope
            outage.target_id = target_id
            outage.scheduled_start = start
            outage.scheduled_end = end
            outage.grace_end = grace
            outage.reason = reason
            outage.cancelled = False
        else:
            outage = ScheduledOutage(
                outage_id=outage_id,
                scope=scope,
                target_id=target_id,
                scheduled_start=start,
                scheduled_end=end,
                grace_end=grace,
                reason=reason,
                cancelled=False,
            )
            db.add(outage)
        saved_count += 1

    await db.commit()

    return {
        "status": "validated",
        "filename": file.filename,
        "total_rows": len(rows),
        "valid_rows": len(valid_rows),
        "invalid_rows": len(invalid_rows),
        "saved_to_db": saved_count,
        "warnings": warnings,
        "invalid_details": invalid_rows[:20],
    }


@router.post("/preview")
async def preview_csv_data(file: UploadFile = File(...), entity: str = "pole"):
    """
    Generate an inspection preview of an uploaded CSV file.
    Returns detected columns, column types, cell error coordinates, and first 50 rows.
    """
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

    columns = list(rows[0].keys())
    required_cols = (
        POLE_REQUIRED if entity == "pole"
        else DT_REQUIRED if entity == "dt"
        else OUTAGE_REQUIRED
    )

    cell_errors = []
    preview_rows = rows[:50]

    for row_idx, row in enumerate(preview_rows, start=1):
        for col in columns:
            val = row.get(col, "").strip()
            # Missing required field
            if col in required_cols and not val:
                cell_errors.append({
                    "row": row_idx,
                    "column": col,
                    "reason": "Missing required value",
                })
            # Coordinate checks
            elif col == "lat" and val:
                try:
                    lat_f = float(val)
                    if not (6.0 <= lat_f <= 38.0):
                        cell_errors.append({"row": row_idx, "column": col, "reason": "Out of India range (6-38°N)"})
                except ValueError:
                    cell_errors.append({"row": row_idx, "column": col, "reason": "Invalid number"})
            elif col == "lon" and val:
                try:
                    lon_f = float(val)
                    if not (66.0 <= lon_f <= 98.0):
                        cell_errors.append({"row": row_idx, "column": col, "reason": "Out of India range (66-98°E)"})
                except ValueError:
                    cell_errors.append({"row": row_idx, "column": col, "reason": "Invalid number"})

    return {
        "filename": file.filename,
        "entity": entity,
        "total_rows": len(rows),
        "columns": columns,
        "required_columns": list(required_cols),
        "preview_rows": preview_rows,
        "cell_errors": cell_errors,
    }


@router.post("/error-report")
async def download_error_report(file: UploadFile = File(...), entity: str = "pole"):
    """Validate CSV and return a downloadable CSV of all row-level errors."""
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")

    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    required_cols = (
        POLE_REQUIRED if entity == "pole"
        else DT_REQUIRED if entity == "dt"
        else OUTAGE_REQUIRED
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["row_number", "field", "value", "error_description"])

    id_col = "pole_id" if entity == "pole" else "dt_id" if entity == "dt" else "outage_id"
    seen_ids = set()

    for i, row in enumerate(rows, start=1):
        for col in required_cols:
            val = row.get(col, "").strip()
            if not val:
                writer.writerow([i, col, "", f"Missing required column {col}"])

        if "lat" in row and row["lat"].strip():
            try:
                lat = float(row["lat"])
                if not (6.0 <= lat <= 38.0):
                    writer.writerow([i, "lat", row["lat"], "Latitude outside territory (6-38°N)"])
            except ValueError:
                writer.writerow([i, "lat", row["lat"], "Invalid float for latitude"])

        if "lon" in row and row["lon"].strip():
            try:
                lon = float(row["lon"])
                if not (66.0 <= lon <= 98.0):
                    writer.writerow([i, "lon", row["lon"], "Longitude outside territory (66-98°E)"])
            except ValueError:
                writer.writerow([i, "lon", row["lon"], "Invalid float for longitude"])

        eid = row.get(id_col, "").strip()
        if eid:
            if eid in seen_ids:
                writer.writerow([i, id_col, eid, f"Duplicate identifier {eid}"])
            seen_ids.add(eid)

    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={entity}_error_report.csv"}
    )

