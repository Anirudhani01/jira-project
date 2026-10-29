"""Comments (M8). Mirrors migration 0009: the composite foreign key to ``issues`` is
``(org_id, issue_id)`` only (plan R3.3 row 17) -- no denormalized ``project_id``, exactly
like ``issue_activity`` (M6)."""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKeyConstraint,
    Index,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
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


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (
        CheckConstraint(
            "body = btrim(body) AND char_length(body) BETWEEN 1 AND 32000", name="body_valid"
        ),
        _fk("fk_comments_org_id_issues", ["org_id", "issue_id"], "issues", ["org_id", "id"]),
        _fk(
            "fk_comments_org_id_author_id_org_memberships",
            ["org_id", "author_id"],
            "org_memberships",
            ["org_id", "user_id"],
        ),
        UniqueConstraint("org_id", "id"),
        Index(
            "ix_comments_issue_id_created_at",
            "issue_id",
            "created_at",
            "id",
            postgresql_where=_NOT_DELETED,
        ),
        _NO_RETURNING,
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    body: Mapped[str] = mapped_column(Text)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
