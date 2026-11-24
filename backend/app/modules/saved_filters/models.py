"""Saved issue-list filters. Private to one user within one project: RLS makes a row
visible and changeable only to the user who owns it."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SavedFilter(Base):
    __tablename__ = "saved_filters"
    __table_args__ = (
        CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 60", name="name_valid"
        ),
        ForeignKeyConstraint(
            ["org_id", "user_id"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_saved_filters_org_id_user_id_org_memberships",
        ),
        ForeignKeyConstraint(
            ["org_id", "project_id"],
            ["projects.org_id", "projects.id"],
            name="fk_saved_filters_org_id_project_id_projects",
        ),
        Index(
            "uq_saved_filters_project_id_user_id_lower_name",
            "project_id",
            "user_id",
            text("lower(name)"),
            unique=True,
        ),
        Index("ix_saved_filters_org_id_project_id_user_id", "org_id", "project_id", "user_id"),
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(60))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
