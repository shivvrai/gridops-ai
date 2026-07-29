"""SQLAlchemy ORM models matching the approved data model."""
from datetime import datetime
from sqlalchemy import (
    Column, Text, Integer, BigInteger, Float, Boolean, DateTime,
    ForeignKey, Index, JSON, func
)
from sqlalchemy.orm import relationship
from app.models.database import Base


class Substation(Base):
    __tablename__ = "substations"

    substation_id = Column(Text, primary_key=True)
    lat = Column(Float)
    lon = Column(Float)

    feeders = relationship("Feeder", back_populates="substation")


class Feeder(Base):
    __tablename__ = "feeders"

    feeder_id = Column(Text, primary_key=True)
    substation_id = Column(Text, ForeignKey("substations.substation_id"), nullable=False)

    substation = relationship("Substation", back_populates="feeders")
    transformers = relationship("DistributionTransformer", back_populates="feeder")


class DistributionTransformer(Base):
    __tablename__ = "distribution_transformers"

    dt_id = Column(Text, primary_key=True)
    feeder_id = Column(Text, ForeignKey("feeders.feeder_id"), nullable=False)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    capacity_kva = Column(Integer)
    households_served = Column(Integer)
    has_surveyed_topology = Column(Boolean, nullable=False, default=False)

    feeder = relationship("Feeder", back_populates="transformers")
    poles = relationship("Pole", back_populates="transformer")


class Pole(Base):
    __tablename__ = "poles"

    pole_id = Column(Text, primary_key=True)
    lat = Column(Float, nullable=False)
    lon = Column(Float, nullable=False)
    feeder_id = Column(Text, ForeignKey("feeders.feeder_id"), nullable=False)
    dt_id = Column(Text, ForeignKey("distribution_transformers.dt_id"), nullable=False)
    seq_on_line = Column(Integer, nullable=True)
    parent_pole_id = Column(Text, ForeignKey("poles.pole_id"), nullable=True)
    pole_type = Column(Text)
    ward = Column(Text)
    pincode = Column(Text)
    device_id = Column(Text, nullable=True)
    topology_source = Column(Text, nullable=False, default="unknown")
    topology_confidence = Column(Text, default="MEDIUM")

    transformer = relationship("DistributionTransformer", back_populates="poles")

    __table_args__ = (
        Index("idx_poles_dt", "dt_id"),
        Index("idx_poles_feeder", "feeder_id"),
    )


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    device_id = Column(Text, nullable=False)
    pole_id = Column(Text, nullable=False)
    event = Column(Text, nullable=False)
    energized = Column(Boolean, nullable=False)
    ts = Column(DateTime(timezone=True), nullable=False)
    received_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    seq = Column(BigInteger, nullable=False)
    battery_mv = Column(Integer)
    rssi = Column(Integer)
    fw = Column(Text)

    __table_args__ = (
        Index("idx_telemetry_pole_time", "pole_id", "received_at"),
        Index("idx_telemetry_dedup", "device_id", "seq"),
    )


class DeviceSeqTracker(Base):
    __tablename__ = "device_seq_tracker"

    device_id = Column(Text, primary_key=True)
    last_seq = Column(BigInteger, nullable=False)
    last_boot_seq = Column(BigInteger)
    last_seen = Column(DateTime(timezone=True), nullable=False)


class PoleState(Base):
    __tablename__ = "pole_states"

    pole_id = Column(Text, ForeignKey("poles.pole_id"), primary_key=True)
    status = Column(Text, nullable=False, default="unknown")
    last_event = Column(Text)
    last_event_at = Column(DateTime(timezone=True))
    device_healthy = Column(Boolean, nullable=False, default=True)
    suspected_dark_at = Column(DateTime(timezone=True))
    confirmed_dark_at = Column(DateTime(timezone=True))
    fw_version = Column(Text)


class Ticket(Base):
    __tablename__ = "tickets"

    ticket_id = Column(BigInteger, primary_key=True, autoincrement=True)
    display_id = Column(Text, unique=True, nullable=False)
    status = Column(Text, nullable=False, default="detected")
    fault_type = Column(Text, nullable=False)

    # Location
    feeder_id = Column(Text, nullable=False)
    dt_id = Column(Text, nullable=True)
    boundary_live_pole = Column(Text, nullable=True)
    boundary_dark_pole = Column(Text, nullable=True)
    fault_lat = Column(Float)
    fault_lon = Column(Float)
    pincode = Column(Text)

    # Range
    is_range = Column(Boolean, nullable=False, default=False)
    range_description = Column(Text)

    # Impact
    affected_pole_count = Column(Integer, nullable=False)
    estimated_households = Column(Integer)

    # Confidence
    confidence_label = Column(Text, nullable=False)
    confidence_factors = Column(JSON)
    topology_source = Column(Text, nullable=False)

    # Timestamps
    detected_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    acknowledged_at = Column(DateTime(timezone=True))
    crew_assigned_at = Column(DateTime(timezone=True))
    resolved_at = Column(DateTime(timezone=True))
    verified_at = Column(DateTime(timezone=True))
    closed_at = Column(DateTime(timezone=True))

    # Suppression
    suppressed_by_outage = Column(Text)

    # Notes
    operator_notes = Column(Text)

    affected_poles = relationship("TicketAffectedPole", back_populates="ticket")

    __table_args__ = (
        Index("idx_tickets_status", "status",
              postgresql_where=(Column("status").notin_(["verified", "closed"]))),
    )


class TicketAffectedPole(Base):
    __tablename__ = "ticket_affected_poles"

    ticket_id = Column(BigInteger, ForeignKey("tickets.ticket_id"), primary_key=True)
    pole_id = Column(Text, ForeignKey("poles.pole_id"), primary_key=True)

    ticket = relationship("Ticket", back_populates="affected_poles")

    __table_args__ = (
        Index("idx_ticket_poles_pole", "pole_id"),
    )


class ScheduledOutage(Base):
    __tablename__ = "scheduled_outages"

    outage_id = Column(Text, primary_key=True)
    scope = Column(Text, nullable=False)
    target_id = Column(Text, nullable=False)
    scheduled_start = Column(DateTime(timezone=True), nullable=False)
    scheduled_end = Column(DateTime(timezone=True), nullable=False)
    grace_end = Column(DateTime(timezone=True), nullable=False)
    reason = Column(Text)
    cancelled = Column(Boolean, nullable=False, default=False)

    __table_args__ = (
        Index("idx_scheduled_outages_active", "target_id", "scheduled_start", "grace_end"),
    )
