"""Retention purge (M12, plan V2.7 / D5): deletes rows past their retention period.

Runs as the dedicated ``app_retention`` role (RETENTION_DATABASE_URL), which can only
``SELECT``/``DELETE`` the tables below. A Postgres advisory lock guarantees a single worker
runs the purge at a time. Deletes are batched so a large backlog never holds long locks.
"""

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

logger = logging.getLogger("app.worker.retention")

# Arbitrary, stable key for ``pg_try_advisory_lock`` (ASCII "retn" + 0x1234).
ADVISORY_LOCK_KEY = 0x7265746E1234


@dataclass(frozen=True, slots=True)
class PurgeRule:
    table: str
    condition: str  # static SQL, never built from input


RULES = (
    PurgeRule("idempotency_keys", "expires_at < now()"),
    PurgeRule("user_tokens", "expires_at < now() - interval '30 days'"),
    PurgeRule("user_sessions", "expires_at < now() - interval '30 days'"),
    PurgeRule("notifications", "created_at < now() - interval '90 days'"),
    PurgeRule("audit_events", "created_at < now() - interval '1 year'"),
    PurgeRule("security.platform_security_events", "occurred_at < now() - interval '1 year'"),
)


async def _purge_table(engine: AsyncEngine, rule: PurgeRule, batch: int, max_batches: int) -> int:
    deleted = 0
    for _ in range(max_batches):
        async with engine.begin() as connection:
            result = await connection.execute(
                text(
                    f"DELETE FROM {rule.table} WHERE ctid IN "  # noqa: S608 - static rule
                    f"(SELECT ctid FROM {rule.table} WHERE {rule.condition} LIMIT :batch)"
                ),
                {"batch": batch},
            )
        count = int(result.rowcount)
        deleted += count
        if count < batch:
            break
    return deleted


async def run_purge(
    engine: AsyncEngine, *, batch: int = 1000, max_batches: int = 100
) -> dict[str, int] | None:
    """Purges every rule once. ``None`` when another worker holds the advisory lock."""
    async with engine.connect() as lock:
        locked = (
            await lock.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
            )
        ).scalar_one()
        await lock.commit()
        if not locked:
            return None
        try:
            totals = {
                rule.table: await _purge_table(engine, rule, batch, max_batches) for rule in RULES
            }
        finally:
            await lock.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY})
            await lock.commit()
    logger.info("retention purge finished", extra={"event": "retention.purged", **totals})
    return totals
