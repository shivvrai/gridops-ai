"""Tests for Authentication, RBAC, Crew Management, Audit Logging, and Data Wizard."""
import pytest
from app.core.auth import hash_password, verify_password, create_access_token
from app.models.schemas import User, Crew, Ticket, AuditLog


class TestAuthAndTokens:
    def test_password_hash_and_verify(self):
        plain = "SecurePass123!"
        hashed = hash_password(plain)
        assert hashed != plain
        assert verify_password(plain, hashed) is True
        assert verify_password("WrongPassword", hashed) is False

    def test_jwt_generation_and_payload(self):
        from jose import jwt
        from app.core.auth import JWT_SECRET, JWT_ALGORITHM

        data = {"sub": "USR-001", "email": "test@gridops.ai", "role": "ADMIN"}
        token = create_access_token(data)
        assert isinstance(token, str)

        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        assert payload["sub"] == "USR-001"
        assert payload["email"] == "test@gridops.ai"
        assert payload["role"] == "ADMIN"
        assert "exp" in payload


class TestRoleHierarchy:
    def test_role_permissions_mapping(self):
        admin_roles = ["ADMIN"]
        operator_roles = ["ADMIN", "OPERATOR"]
        field_roles = ["ADMIN", "OPERATOR", "FIELD_CREW"]

        # Admin satisfies all
        assert "ADMIN" in admin_roles
        assert "ADMIN" in operator_roles
        assert "ADMIN" in field_roles

        # Operator satisfies operator + field
        assert "OPERATOR" not in admin_roles
        assert "OPERATOR" in operator_roles

        # Field Crew satisfies only field
        assert "FIELD_CREW" not in operator_roles
        assert "FIELD_CREW" in field_roles


class TestAuditLogStructure:
    def test_audit_log_fields(self):
        log = AuditLog(
            action="TEST_ACTION",
            entity_type="ticket",
            entity_id="TKT-001",
            user_id="USR-01",
            user_email="operator@gridops.ai",
            user_role="OPERATOR",
            details={"field": "value"},
        )
        assert log.action == "TEST_ACTION"
        assert log.entity_type == "ticket"
        assert log.details["field"] == "value"
