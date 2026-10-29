"""In-app notifications (M11, plan §2.3, R3.3 row 22). Each row belongs to one recipient;
RLS makes it readable and updatable by that recipient only."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKeyConstraint, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

TYPES = ("issue_assigned", "issue_commented", "issue_status_changed")


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (
        CheckConstraint(
            "type IN ('issue_assigned', 'issue_commented', 'issue_status_changed')",
            name="type_valid",
        ),
        ForeignKeyConstraint(
            ["org_id", "recipient_id"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_notifications_org_id_recipient_id_org_memberships",
        ),
        ForeignKeyConstraint(
            ["org_id", "actor_id"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_notifications_org_id_actor_id_org_memberships",
        ),
        ForeignKeyConstraint(
            ["org_id", "issue_id"],
            ["issues.org_id", "issues.id"],
            name="fk_notifications_org_id_issue_id_issues",
        ),
        Index(
            "ix_notifications_org_id_recipient_id_created_at",
            "org_id",
            "recipient_id",
            text("created_at DESC"),
            text("id DESC"),
        ),
        Index(
            "ix_notifications_org_id_recipient_id_unread",
            "org_id",
            "recipient_id",
            postgresql_where=text("read_at IS NULL"),
        ),
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    recipient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    type: Mapped[str] = mapped_column(String(32))
    issue_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
