"""Org authentication projection reconciliation (A3.2).

Runs as ``app_worker`` on WORKER_DATABASE_URL, calling
``security.reconcile_org_auth_projections`` on a fixed interval. A session advisory lock
ensures only one worker reconciles at a time; lock acquire, reconcile, and release share
one connection. Failures are logged and retried at the next interval without affecting
outbox delivery (separate asyncio task in ``app.worker.main``).
"""

import asyncio
import logging
from contextlib import suppress

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.config import Settings

logger = logging.getLogger("app.worker.org_auth_reconciliation")

# Stable key for ``pg_try_advisory_lock`` (ASCII "oarc" + 0xA32).
ADVISORY_LOCK_KEY = 0x6F6172630A32


async def run_org_auth_reconciliation(engine: AsyncEngine, *, batch: int = 100) -> int | None:
    """Reconcile one batch. ``None`` when another session holds the advisory lock."""
    async with engine.connect() as conn:
        locked = (
            await conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
            )
        ).scalar_one()
        await conn.commit()
        if not locked:
            return None
        try:
            async with conn.begin():
                applied = (
                    await conn.execute(
                        text("SELECT security.reconcile_org_auth_projections(:limit)"),
                        {"limit": batch},
                    )
                ).scalar_one()
            return int(applied)
        finally:
            await conn.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY})
            await conn.commit()


async def org_auth_reconciliation_loop(
    settings: Settings, engine: AsyncEngine, stopping: asyncio.Event
) -> None:
    """Periodic reconciliation until ``stopping`` is set."""
    interval = settings.org_auth_reconciliation_interval_seconds
    batch = settings.org_auth_reconciliation_batch_size
    while not stopping.is_set():
        try:
            applied = await run_org_auth_reconciliation(engine, batch=batch)
            if applied is None:
                logger.info(
                    "org auth reconciliation skipped",
                    extra={"event": "org_auth_reconciliation.locked"},
                )
            else:
                logger.info(
                    "org auth reconciliation finished",
                    extra={
                        "event": "org_auth_reconciliation.applied",
                        "applied": applied,
                    },
                )
        except Exception as exc:
            logger.error(
                "org auth reconciliation failed",
                extra={
                    "event": "org_auth_reconciliation.failed",
                    "error_type": type(exc).__name__,
                },
            )
        with suppress(TimeoutError):
            await asyncio.wait_for(stopping.wait(), timeout=interval)
