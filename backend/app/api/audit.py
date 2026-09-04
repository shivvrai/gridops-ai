"""Audit log querying API for administrators."""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import get_db
from app.models.schemas import AuditLog, User
from app.core.auth import require_roles

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/")
@router.get("")
async def list_audit_logs(
    limit: int = Query(100, ge=1, le=500),
    action: Optional[str] = None,
    user_id: Optional[str] = None,
    admin: User = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only: list audit trail entries."""
    query = select(AuditLog).order_by(AuditLog.timestamp.desc()).limit(limit)

    if action:
        query = query.where(AuditLog.action == action)
    if user_id:
        query = query.where(AuditLog.user_id == user_id)

    result = await db.execute(query)
    logs = result.scalars().all()

    return [
        {
            "id": l.id,
            "timestamp": l.timestamp.isoformat() if l.timestamp else None,
            "user_id": l.user_id,
            "user_email": l.user_email,
            "user_role": l.user_role,
            "action": l.action,
            "entity_type": l.entity_type,
            "entity_id": l.entity_id,
            "details": l.details,
            "ip_address": l.ip_address,
        }
        for l in logs
    ]
