"""Projects and their seeded configuration (M5). Mirrors migration 0006: every tenant
foreign key is composite and includes ``org_id`` (plan R3.3 rows 4-8, 19-20)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

KEY_PATTERN = r"^[A-Z][A-Z0-9]{1,9}$"
PROJECT_ROLES = ("admin", "member", "viewer")
_NO_RETURNING = {"implicit_returning": False}


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )


def _fk(
    name: str, cols: list[str], table: str, refcols: list[str], ondelete: str | None = None
) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        cols, [f"{table}.{c}" for c in refcols], name=name, ondelete=ondelete
    )


class Workflow(Base):
    __tablename__ = "workflows"
    __table_args__ = (
        _fk(
            "fk_workflows_org_id_organizations",
            ["org_id"],
            "organizations",
            ["id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["org_id", "id", "initial_status_id"],
            ["workflow_statuses.org_id", "workflow_statuses.workflow_id", "workflow_statuses.id"],
            name="fk_workflows_org_id_initial_status_workflow_statuses",
            deferrable=True,
            initially="DEFERRED",
            use_alter=True,
        ),
        UniqueConstraint("org_id", "id"),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(100))
    initial_status_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))


class WorkflowStatus(Base):
    __tablename__ = "workflow_statuses"
    __table_args__ = (
        CheckConstraint("category IN ('todo', 'in_progress', 'done')", name="category_valid"),
        _fk(
            "fk_workflow_statuses_org_id_workflows",
            ["org_id", "workflow_id"],
            "workflows",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("org_id", "workflow_id", "id"),
        UniqueConstraint("workflow_id", "name"),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    workflow_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(CITEXT)
    category: Mapped[str] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer)


class WorkflowTransition(Base):
    __tablename__ = "workflow_transitions"
    __table_args__ = (
        _fk(
            "fk_workflow_transitions_org_id_workflows",
            ["org_id", "workflow_id"],
            "workflows",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_workflow_transitions_org_id_from_status",
            ["org_id", "workflow_id", "from_status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
        ),
        _fk(
            "fk_workflow_transitions_org_id_to_status",
            ["org_id", "workflow_id", "to_status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
        ),
        UniqueConstraint(
            "workflow_id", "from_status_id", "to_status_id", postgresql_nulls_not_distinct=True
        ),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    workflow_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(100))
    from_status_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # NULL = any
    to_status_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (
        CheckConstraint(f"key ~ '{KEY_PATTERN}'", name="key_format"),
        CheckConstraint("board_type IN ('kanban', 'scrum')", name="board_type_valid"),
        CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100", name="name_valid"
        ),
        _fk(
            "fk_projects_org_id_workflows", ["org_id", "workflow_id"], "workflows", ["org_id", "id"]
        ),
        _fk(
            "fk_projects_org_id_created_by_org_memberships",
            ["org_id", "created_by"],
            "org_memberships",
            ["org_id", "user_id"],
        ),
        UniqueConstraint("org_id", "key"),
        UniqueConstraint("org_id", "id"),
        UniqueConstraint("org_id", "id", "workflow_id"),
        UniqueConstraint("workflow_id"),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    key: Mapped[str] = mapped_column(String(10))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(2000))
    board_type: Mapped[str] = mapped_column(String(16))
    workflow_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class ProjectIssueCounter(Base):
    __tablename__ = "project_issue_counters"
    __table_args__ = (
        _fk(
            "fk_project_issue_counters_org_id_projects",
            ["org_id", "project_id"],
            "projects",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        _NO_RETURNING,
    )

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    next_seq: Mapped[int] = mapped_column(Integer, server_default=text("0"))


class ProjectMembership(Base):
    __tablename__ = "project_memberships"
    __table_args__ = (
        CheckConstraint("role IN ('admin', 'member', 'viewer')", name="role_valid"),
        _fk(
            "fk_project_memberships_org_id_projects",
            ["org_id", "project_id"],
            "projects",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_project_memberships_org_id_org_memberships",
            ["org_id", "user_id"],
            "org_memberships",
            ["org_id", "user_id"],
            ondelete="RESTRICT",
        ),
        Index("ix_project_memberships_org_id_user_id", "org_id", "user_id"),
        _NO_RETURNING,
    )

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    role: Mapped[str] = mapped_column(String(16))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class Board(Base):
    __tablename__ = "boards"
    __table_args__ = (
        _fk(
            "fk_boards_org_id_projects",
            ["org_id", "project_id", "workflow_id"],
            "projects",
            ["org_id", "id", "workflow_id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("project_id"),
        UniqueConstraint("org_id", "id"),
        UniqueConstraint("org_id", "id", "workflow_id"),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    workflow_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(100))


class BoardColumn(Base):
    __tablename__ = "board_columns"
    __table_args__ = (
        _fk(
            "fk_board_columns_org_id_boards",
            ["org_id", "board_id"],
            "boards",
            ["org_id", "id"],
            ondelete="CASCADE",
        ),
        UniqueConstraint("board_id", "position", deferrable=True, initially="DEFERRED"),
        UniqueConstraint("org_id", "board_id", "id"),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    board_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(100))
    position: Mapped[int] = mapped_column(Integer)
    wip_limit: Mapped[int | None] = mapped_column(Integer)


class BoardColumnStatus(Base):
    __tablename__ = "board_column_statuses"
    __table_args__ = (
        _fk(
            "fk_board_column_statuses_org_id_board_columns",
            ["org_id", "board_id", "column_id"],
            "board_columns",
            ["org_id", "board_id", "id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_board_column_statuses_org_id_boards",
            ["org_id", "board_id", "workflow_id"],
            "boards",
            ["org_id", "id", "workflow_id"],
            ondelete="CASCADE",
        ),
        _fk(
            "fk_board_column_statuses_org_id_workflow_statuses",
            ["org_id", "workflow_id", "status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
        ),
        _NO_RETURNING,
    )

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    board_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workflow_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    column_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    status_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
