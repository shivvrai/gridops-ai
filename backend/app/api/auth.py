"""Authentication and User Management API."""
import logging
import uuid
from typing import Optional, List
from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.database import get_db
from app.models.schemas import User
from app.core.auth import (
    hash_password, verify_password, create_access_token,
    get_current_user, require_roles, record_audit_log
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class CreateUserRequest(BaseModel):
    email: str
    password: str
    name: str
    role: str  # ADMIN, OPERATOR, FIELD_CREW


class UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None


@router.post("/login", response_model=LoginResponse)
async def login(
    req: LoginRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate user and return JWT token."""
    client_ip = request.client.host if request.client else None
    email_clean = req.email.strip().lower()

    result = await db.execute(select(User).where(User.email == email_clean))
    user = result.scalar_one_or_none()

    if not user or not verify_password(req.password, user.hashed_password):
        await record_audit_log(
            db, action="FAILED_LOGIN",
            details={"email": email_clean},
            ip_address=client_ip
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        await record_audit_log(
            db, action="FAILED_LOGIN_DEACTIVATED",
            user=user,
            ip_address=client_ip
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account has been deactivated. Please contact an administrator.",
        )

    token = create_access_token({"sub": user.user_id, "email": user.email, "role": user.role})

    await record_audit_log(
        db, action="LOGIN",
        user=user,
        ip_address=client_ip
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "user_id": user.user_id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
        },
    }


@router.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    """Return profile of currently authenticated user."""
    return {
        "user_id": user.user_id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


@router.get("/users")
async def list_users(
    admin: User = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only: list all system users."""
    result = await db.execute(select(User).order_by(User.created_at.desc()))
    users = result.scalars().all()
    return [
        {
            "user_id": u.user_id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in users
    ]


@router.post("/users", status_code=status.HTTP_201_CREATED)
async def create_user(
    req: CreateUserRequest,
    admin: User = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only: create a new user."""
    valid_roles = ("ADMIN", "OPERATOR", "FIELD_CREW")
    if req.role.upper() not in valid_roles:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role '{req.role}'. Must be one of: {', '.join(valid_roles)}",
        )

    email_clean = req.email.strip().lower()
    existing = await db.execute(select(User).where(User.email == email_clean))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User with this email already exists")

    new_user = User(
        user_id=f"USR-{uuid.uuid4().hex[:8].upper()}",
        email=email_clean,
        hashed_password=hash_password(req.password),
        name=req.name.strip(),
        role=req.role.upper(),
        is_active=True,
    )
    db.add(new_user)
    await db.commit()

    await record_audit_log(
        db, action="USER_CREATED",
        entity_type="user", entity_id=new_user.user_id,
        details={"email": new_user.email, "role": new_user.role, "name": new_user.name},
        user=admin,
    )

    return {
        "status": "created",
        "user_id": new_user.user_id,
        "email": new_user.email,
        "name": new_user.name,
        "role": new_user.role,
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    req: UpdateUserRequest,
    admin: User = Depends(require_roles(["ADMIN"])),
    db: AsyncSession = Depends(get_db),
):
    """Admin-only: update user role, name, status, or password."""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    changes = {}
    if req.name is not None:
        user.name = req.name.strip()
        changes["name"] = user.name
    if req.role is not None:
        if req.role.upper() not in ("ADMIN", "OPERATOR", "FIELD_CREW"):
            raise HTTPException(status_code=400, detail="Invalid role")
        user.role = req.role.upper()
        changes["role"] = user.role
    if req.is_active is not None:
        user.is_active = req.is_active
        changes["is_active"] = user.is_active
    if req.password:
        user.hashed_password = hash_password(req.password)
        changes["password_updated"] = True

    await db.commit()

    await record_audit_log(
        db, action="USER_UPDATED",
        entity_type="user", entity_id=user.user_id,
        details=changes,
        user=admin,
    )

    return {
        "status": "updated",
        "user_id": user.user_id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
    }
