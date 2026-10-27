"""Transactional outbox (plan R4/R5): jobs written in the same transaction as the change.

Payloads hold identifiers only (never tokens, passwords or email bodies). Grants: the API
role may INSERT only; the worker role may SELECT/UPDATE.

Tenant scope (M3, plan R3.2): ``org_id`` is NULL for platform jobs (the M2 identity
emails) and set for tenant jobs. Under FORCED RLS the API role may only insert rows with a
NULL ``org_id`` or the bound org it is an active member of; the worker role sees every row
and must bind the job's org (``bind_job_context``) before touching tenant tables. No
tenant-scoped topic exists yet (enforced by ``test_tenant_topics_require_org_id``).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Identity, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class OutboxJob(Base):
    __tablename__ = "outbox"
    __table_args__ = (
        Index(
            "ix_outbox_available_at_pending",
            "available_at",
            postgresql_where=text("processed_at IS NULL AND dead_at IS NULL"),
        ),
        Index("ix_outbox_dead_at", "dead_at", postgresql_where=text("dead_at IS NOT NULL")),
        # The API role has INSERT but not SELECT: never ask for RETURNING.
        {"implicit_returning": False},
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    topic: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    available_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    last_error: Mapped[str | None] = mapped_column(String(200))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    dead_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
