"""Platform security events (plan V2.7): global, append-only, separate schema.

Runtime roles may INSERT only; reading requires the ``platform_security_reader`` role.
Never contains passwords, hashes, tokens, cookies or raw unknown email addresses.
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Identity, Index, String, text
from sqlalchemy.dialects.postgresql import INET, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

SECURITY_SCHEMA = "security"


class PlatformSecurityEvent(Base):
    __tablename__ = "platform_security_events"
    __table_args__ = (
        Index("ix_platform_security_events_occurred_at", "occurred_at"),
        Index("ix_platform_security_events_user_id_occurred_at", "user_id", "occurred_at"),
        # Runtime roles have INSERT but not SELECT: never ask for RETURNING.
        {"schema": SECURITY_SCHEMA, "implicit_returning": False},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    occurred_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    event_type: Mapped[str] = mapped_column(String(64))
    outcome: Mapped[str] = mapped_column(String(16))
    # No FK: events must outlive and not block user lifecycle operations.
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    email_hmac: Mapped[str | None] = mapped_column(String(64))
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(256))
    request_id: Mapped[str | None] = mapped_column(String(128))
    reason: Mapped[str | None] = mapped_column(String(64))
    event_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, server_default=text("'{}'::jsonb")
    )
