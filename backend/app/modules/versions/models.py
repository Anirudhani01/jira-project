"""Versions / releases (plan: epics, versions and bulk change research). One fix version per
issue (``issues.fix_version_id``); a version is unreleased, released or archived."""

import uuid
from datetime import date, datetime

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Version(Base):
    __tablename__ = "versions"
    __table_args__ = (
        CheckConstraint("status IN ('unreleased', 'released', 'archived')", name="status_valid"),
        CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100", name="name_valid"
        ),
        CheckConstraint(
            "description IS NULL OR char_length(description) <= 1000", name="description_length"
        ),
        CheckConstraint(
            "start_date IS NULL OR release_date IS NULL OR release_date >= start_date",
            name="dates_ordered",
        ),
        CheckConstraint(
            "status <> 'released' OR released_at IS NOT NULL", name="released_has_time"
        ),
        ForeignKeyConstraint(
            ["org_id", "project_id"],
            ["projects.org_id", "projects.id"],
            name="fk_versions_org_id_projects",
        ),
        UniqueConstraint("org_id", "project_id", "id"),
        UniqueConstraint("project_id", "name"),
        Index("ix_versions_project_id_position", "project_id", "position"),
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(CITEXT)
    description: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date | None] = mapped_column(Date)
    release_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(16), server_default=text("'unreleased'"))
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
