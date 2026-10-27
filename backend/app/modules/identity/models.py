"""Identity tables: users and server-side sessions.

``users`` is global (no org) and protected by RLS (see migration 0002): a runtime role
can see only the bound user or the row matching the bound auth-lookup email.
``user_sessions`` has no RLS; only this module's repository touches it, always by
token hash or by the authenticated user's id.
"""

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, LargeBinary, String, text
from sqlalchemy.dialects.postgresql import CITEXT, INET, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

USER_STATUSES = ("active", "disabled")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'disabled')", name="status_valid"),
        CheckConstraint("char_length(display_name) BETWEEN 1 AND 100", name="display_name_len"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(16), server_default=text("'active'"))
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    password_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index(
            "ix_user_sessions_user_id_active",
            "user_id",
            postgresql_where=text("revoked_at IS NULL"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoke_reason: Mapped[str | None] = mapped_column(String(32))
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(String(256))
