"""Organization-scoped authentication activity (A3.2): projected from platform security events.

Rows are inserted only by database triggers / reconciliation (``app_owner`` DEFINER
functions). Runtime API roles may SELECT under RLS (org owners/admins). Not org audit
(``audit_events``) and not the platform security event store.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OrgAuthenticationEvent(Base):
    __tablename__ = "org_authentication_events"
    __table_args__ = (
        UniqueConstraint("platform_event_id", "org_id", name="uq_org_auth_events_platform_org"),
        Index("ix_org_auth_events_org_occurred_id", "org_id", "occurred_at", "id"),
        Index("ix_org_auth_events_org_user_occurred", "org_id", "user_id", "occurred_at"),
        {"implicit_returning": False},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    platform_event_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    event_type: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(16))
    reason: Mapped[str | None] = mapped_column(String(64))
    event_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, server_default=text("'{}'::jsonb")
    )
    member_display_name: Mapped[str] = mapped_column(Text)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
