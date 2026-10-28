"""Issues, issue activity and idempotency keys (M6). Mirrors migration 0007: every tenant
foreign key is composite and includes ``org_id`` (plan R3.3 rows 9-15)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Identity,
    Index,
    Integer,
    LargeBinary,
    PrimaryKeyConstraint,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

_NO_RETURNING = {"implicit_returning": False}
_NOT_DELETED = text("deleted_at IS NULL")


def _fk(
    name: str, cols: list[str], table: str, refcols: list[str], ondelete: str = "RESTRICT"
) -> ForeignKeyConstraint:
    return ForeignKeyConstraint(
        cols, [f"{table}.{c}" for c in refcols], name=name, ondelete=ondelete
    )


def _member_fk(table: str, column: str) -> ForeignKeyConstraint:
    return _fk(
        f"fk_{table}_org_id_{column}_org_memberships",
        ["org_id", column],
        "org_memberships",
        ["org_id", "user_id"],
    )


class Issue(Base):
    __tablename__ = "issues"
    __table_args__ = (
        CheckConstraint("seq > 0", name="seq_positive"),
        CheckConstraint(
            "summary = btrim(summary) AND char_length(summary) BETWEEN 1 AND 255",
            name="summary_valid",
        ),
        CheckConstraint(
            "description IS NULL OR char_length(description) <= 32000", name="description_length"
        ),
        CheckConstraint("parent_id <> id", name="parent_not_self"),
        CheckConstraint("version > 0", name="version_positive"),
        _fk(
            "fk_issues_org_id_projects",
            ["org_id", "project_id", "workflow_id"],
            "projects",
            ["org_id", "id", "workflow_id"],
        ),
        _fk(
            "fk_issues_org_id_workflow_statuses",
            ["org_id", "workflow_id", "status_id"],
            "workflow_statuses",
            ["org_id", "workflow_id", "id"],
        ),
        _fk("fk_issues_org_id_issue_types", ["org_id", "type_id"], "issue_types", ["org_id", "id"]),
        _fk(
            "fk_issues_org_id_priorities",
            ["org_id", "priority_id"],
            "priorities",
            ["org_id", "id"],
        ),
        _fk(
            "fk_issues_org_id_parent_issues",
            ["org_id", "project_id", "parent_id"],
            "issues",
            ["org_id", "project_id", "id"],
        ),
        _member_fk("issues", "reporter_id"),
        _member_fk("issues", "assignee_id"),
        UniqueConstraint("project_id", "seq"),
        UniqueConstraint("org_id", "id"),
        UniqueConstraint("org_id", "project_id", "id"),
        Index(
            "ix_issues_project_id_status_id_rank",
            "project_id",
            "status_id",
            "rank",
            "id",
            postgresql_where=_NOT_DELETED,
        ),
        Index(
            "ix_issues_project_id_sprint_id_rank",
            "project_id",
            "sprint_id",
            "rank",
            postgresql_where=_NOT_DELETED,
        ),
        Index(
            "ix_issues_org_id_assignee_id",
            "org_id",
            "assignee_id",
            postgresql_where=_NOT_DELETED,
        ),
        Index("ix_issues_parent_id", "parent_id"),
        Index("ix_issues_project_id_updated_at", "project_id", text("updated_at DESC")),
        Index("ix_issues_org_id_updated_at", "org_id", text("updated_at DESC"), "id"),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    workflow_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    seq: Mapped[int] = mapped_column(Integer)
    type_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    status_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    priority_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # written from M7
    assignee_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # set from M7
    reporter_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    sprint_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))  # FK in M10
    summary: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    rank: Mapped[str] = mapped_column(Text(collation="C"))
    version: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IssueActivity(Base):
    """Append-only for the runtime role (no UPDATE/DELETE grant)."""

    __tablename__ = "issue_activity"
    __table_args__ = (
        _fk("fk_issue_activity_org_id_issues", ["org_id", "issue_id"], "issues", ["org_id", "id"]),
        _member_fk("issue_activity", "actor_id"),
        Index("ix_issue_activity_issue_id_created_at", "issue_id", "created_at", "id"),
        _NO_RETURNING,
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    actor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(32))
    field: Mapped[str | None] = mapped_column(String(32))
    old_value: Mapped[Any] = mapped_column(JSONB, nullable=True)
    new_value: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"
    __table_args__ = (
        _member_fk("idempotency_keys", "user_id"),
        PrimaryKeyConstraint("org_id", "user_id", "key"),
        _NO_RETURNING,
    )

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    key: Mapped[str] = mapped_column(String(64))
    request_hash: Mapped[bytes] = mapped_column(LargeBinary)
    response_status: Mapped[int | None] = mapped_column(SmallInteger)
    response_body: Mapped[Any] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
