"""Transactional outbox (plan R4/R5): jobs written in the same transaction as the change.

Payloads hold identifiers only (never tokens, passwords or email bodies). Grants: the API
role may INSERT only; the worker role may SELECT/UPDATE.

TEMPORARY M2 DECISION: no ``org_id`` column and no RLS. This is safe only because every M2
job is a global identity email keyed by user id (enforced by the unit test
``test_outbox_carries_no_tenant_jobs_until_m3``). M3 must add ``org_id`` and the plan R3.2
outbox policies before any tenant-scoped topic exists. It is not a tenant-isolation
assumption.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Identity, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB
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
