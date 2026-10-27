"""Worker-side outbox operations (plan R4, R5). Runs as the worker role only.

Delivery is at-least-once: a job is claimed with a lease (``locked_until``) and
``attempts`` is incremented at claim time, so a crash after sending but before the ack
leads to redelivery once the lease expires. ``FOR UPDATE SKIP LOCKED`` means concurrent
workers never claim the same job, and one poison job never blocks the others.
Ack/fail are guarded by the ``attempts`` value seen at claim time: a worker whose lease
expired (and whose job was re-claimed) cannot overwrite the new owner's state.
"""

import random
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

MAX_BACKOFF_SECONDS = 6 * 3600
BASE_BACKOFF_SECONDS = 60
MAX_ERROR_LENGTH = 200


@dataclass(frozen=True, slots=True)
class ClaimedJob:
    id: int
    topic: str
    payload: dict[str, Any]
    attempts: int


@dataclass(frozen=True, slots=True)
class DeadJob:
    id: int
    topic: str
    attempts: int
    last_error: str | None
    created_at: datetime
    dead_at: datetime


def backoff_seconds(attempts: int, *, jitter: float | None = None) -> float:
    """``min(6h, 1m * 5^(attempts-1))`` plus up to 10% jitter (plan R5)."""
    base = float(min(MAX_BACKOFF_SECONDS, BASE_BACKOFF_SECONDS * 5 ** max(attempts - 1, 0)))
    fraction = random.random() if jitter is None else jitter  # noqa: S311 - not security
    return base * (1 + 0.1 * fraction)


_CLAIM = text(
    """
    UPDATE outbox
       SET locked_until = now() + make_interval(secs => :lease), attempts = attempts + 1
     WHERE id IN (
           SELECT id FROM outbox
            WHERE processed_at IS NULL AND dead_at IS NULL AND available_at <= now()
              AND (locked_until IS NULL OR locked_until < now())
            ORDER BY id
            LIMIT :batch
              FOR UPDATE SKIP LOCKED)
    RETURNING id, topic, payload, attempts
    """
)


async def claim(session: AsyncSession, *, batch: int, lease_seconds: int) -> list[ClaimedJob]:
    rows = (await session.execute(_CLAIM, {"batch": batch, "lease": lease_seconds})).all()
    jobs = [
        ClaimedJob(id=r.id, topic=r.topic, payload=dict(r.payload), attempts=r.attempts)
        for r in rows
    ]
    return sorted(jobs, key=lambda job: job.id)


async def ack(session: AsyncSession, job: ClaimedJob) -> bool:
    result = await session.execute(
        text(
            """
            UPDATE outbox SET processed_at = now(), locked_until = NULL, last_error = NULL
             WHERE id = :id AND attempts = :attempts AND processed_at IS NULL
               AND dead_at IS NULL
            RETURNING id
            """
        ),
        {"id": job.id, "attempts": job.attempts},
    )
    return result.first() is not None


async def fail(session: AsyncSession, job: ClaimedJob, *, error: str, max_attempts: int) -> bool:
    """Schedule a retry with backoff, or dead-letter after ``max_attempts``.

    ``error`` must not contain secrets: callers pass an exception *type name* only.
    Returns True when the job was dead-lettered.
    """
    dead = job.attempts >= max_attempts
    await session.execute(
        text(
            """
            UPDATE outbox
               SET locked_until = NULL,
                   last_error = :error,
                   available_at = now() + make_interval(secs => :delay),
                   dead_at = CASE WHEN :dead THEN now() ELSE NULL END
             WHERE id = :id AND attempts = :attempts AND processed_at IS NULL
               AND dead_at IS NULL
            """
        ),
        {
            "id": job.id,
            "attempts": job.attempts,
            "error": error[:MAX_ERROR_LENGTH],
            "delay": 0.0 if dead else backoff_seconds(job.attempts),
            "dead": dead,
        },
    )
    return dead


async def release(session: AsyncSession, job: ClaimedJob) -> None:
    """Give back a claimed job that was never started (graceful shutdown)."""
    await session.execute(
        text(
            """
            UPDATE outbox SET locked_until = NULL, attempts = attempts - 1
             WHERE id = :id AND attempts = :attempts AND processed_at IS NULL
               AND dead_at IS NULL
            """
        ),
        {"id": job.id, "attempts": job.attempts},
    )


async def list_dead(session: AsyncSession, *, limit: int = 100) -> list[DeadJob]:
    rows = (
        await session.execute(
            text(
                """
                SELECT id, topic, attempts, last_error, created_at, dead_at FROM outbox
                 WHERE dead_at IS NOT NULL ORDER BY dead_at DESC, id DESC LIMIT :limit
                """
            ),
            {"limit": limit},
        )
    ).all()
    return [
        DeadJob(
            id=r.id,
            topic=r.topic,
            attempts=r.attempts,
            last_error=r.last_error,
            created_at=r.created_at,
            dead_at=r.dead_at,
        )
        for r in rows
    ]


async def requeue(session: AsyncSession, job_id: int) -> bool:
    """Return a dead-lettered job to the queue with a fresh attempt budget."""
    result = await session.execute(
        text(
            """
            UPDATE outbox
               SET dead_at = NULL, attempts = 0, last_error = NULL, locked_until = NULL,
                   available_at = now()
             WHERE id = :id AND dead_at IS NOT NULL
            RETURNING id
            """
        ),
        {"id": job_id},
    )
    return result.first() is not None
