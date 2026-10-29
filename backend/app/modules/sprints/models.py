"""Sprints (M10, plan §2.3, R3.3 rows 15/21). Sprint membership is ``issues.sprint_id``."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class Sprint(Base):
    __tablename__ = "sprints"
    __table_args__ = (
        CheckConstraint("state IN ('future', 'active', 'closed')", name="state_valid"),
        CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100", name="name_valid"
        ),
        CheckConstraint("goal IS NULL OR char_length(goal) <= 1000", name="goal_length"),
        CheckConstraint(
            "(start_at IS NULL) = (end_at IS NULL) AND (end_at IS NULL OR end_at > start_at)",
            name="dates_valid",
        ),
        CheckConstraint("state = 'future' OR start_at IS NOT NULL", name="started_has_dates"),
        CheckConstraint(
            "(completed_at IS NOT NULL) = (state = 'closed')", name="completed_matches_state"
        ),
        ForeignKeyConstraint(
            ["org_id", "project_id"],
            ["projects.org_id", "projects.id"],
            name="fk_sprints_org_id_projects",
        ),
        UniqueConstraint("org_id", "project_id", "id"),
        Index(
            "uq_sprints_project_id_active",
            "project_id",
            unique=True,
            postgresql_where=text("state = 'active'"),
        ),
        Index("ix_sprints_project_id_state", "project_id", "state"),
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(100))
    goal: Mapped[str | None] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(16), server_default=text("'future'"))
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
