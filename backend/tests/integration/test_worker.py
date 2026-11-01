"""Outbox delivery semantics (plan R4, R5): at-least-once with leases, backoff,
dead-lettering after the attempt budget, CLI requeue, same-transaction enqueue."""

import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app import cli
from app.modules.outbox import repository as outbox
from app.modules.outbox import service as enqueueing
from app.modules.outbox.repository import ClaimedJob, backoff_seconds
from app.worker.main import Handler
from tests.integration.auth_support import superuser_sql
from tests.integration.email_support import run_worker, settle_outbox, worker_settings

TOPIC = "email.verify"


@pytest.fixture(autouse=True)
async def _empty_queue() -> None:
    await settle_outbox()


async def add_job(topic: str = TOPIC, user_id: str | None = None) -> int:
    [row] = await superuser_sql(
        "INSERT INTO outbox (topic, payload) VALUES (:t, jsonb_build_object('user_id', "
        "CAST(:u AS text))) RETURNING id",
        t=topic,
        u=user_id or str(uuid.uuid4()),
    )
    return int(row.id)


async def job(job_id: int) -> object:
    [row] = await superuser_sql(
        "SELECT attempts, last_error, processed_at, dead_at, locked_until, "
        "extract(epoch FROM available_at - now()) AS delay FROM outbox WHERE id = :id",
        id=job_id,
    )
    return row


def recording(calls: list[int], error: Exception | None = None) -> dict[str, Handler]:
    async def handle(claimed: ClaimedJob) -> str:
        calls.append(claimed.id)
        if error is not None:
            raise error
        return "sent"

    return {TOPIC: handle}


async def make_due(job_id: int) -> None:
    await superuser_sql("UPDATE outbox SET available_at = now() WHERE id = :id", id=job_id)


# ----------------------------------------------------------------------- enqueue
async def test_enqueue_is_part_of_the_callers_transaction(rw_engine: AsyncEngine) -> None:
    marker = uuid.uuid4()
    async with rw_engine.connect() as conn, AsyncSession(bind=conn) as session:
        await session.begin()
        await enqueueing.enqueue(session, TOPIC, {"user_id": marker})
        await session.rollback()
        await session.begin()
        await enqueueing.enqueue(session, TOPIC, {"user_id": marker})
        await session.commit()
    rows = await superuser_sql(
        "SELECT id FROM outbox WHERE payload->>'user_id' = :u", u=str(marker)
    )
    assert len(rows) == 1  # the rolled-back enqueue left nothing behind


@pytest.mark.parametrize(
    ("topic", "payload"),
    [
        ("email.unknown", {"user_id": None}),
        (TOPIC, {}),
        (TOPIC, {"user_id": None, "token": None}),
    ],
)
async def test_enqueue_rejects_unknown_topics_and_keys(
    rw_engine: AsyncEngine, topic: str, payload: dict[str, uuid.UUID | None]
) -> None:
    async with AsyncSession(bind=rw_engine) as session, session.begin():
        with pytest.raises(ValueError, match=r"topic|keys"):
            await enqueueing.enqueue(session, topic, payload)


# ------------------------------------------------------------------- retry/dead-letter
async def test_failure_is_retried_with_backoff_and_records_only_the_error_type() -> None:
    job_id = await add_job()
    [pending] = await superuser_sql(
        "SELECT count(*) AS n FROM outbox WHERE processed_at IS NULL AND dead_at IS NULL"
    )
    assert int(pending.n) == 1
    calls: list[int] = []
    secret = RuntimeError("smtp said no for victim@example.com")
    await run_worker(handlers=recording(calls, secret))
    row = await job(job_id)
    assert calls == [job_id]
    assert row.attempts == 1  # type: ignore[attr-defined]
    assert row.last_error == "RuntimeError"  # type: ignore[attr-defined]
    assert row.processed_at is None  # type: ignore[attr-defined]
    assert row.dead_at is None  # type: ignore[attr-defined]
    assert row.locked_until is None  # type: ignore[attr-defined]
    # Backoff is 60s + up to 10% jitter; allow clock skew between fail and this read.
    assert 55 <= row.delay <= 72  # type: ignore[attr-defined]
    # Not due yet: a second run does not touch it.
    await run_worker(handlers=recording(calls, secret))
    assert calls == [job_id]


def test_backoff_schedule_matches_plan() -> None:
    assert [backoff_seconds(n, jitter=0) for n in (1, 2, 3, 4, 5, 6, 10)] == [
        60,
        300,
        1500,
        7500,
        21600,
        21600,
        21600,
    ]
    assert backoff_seconds(1, jitter=1) == pytest.approx(66)


async def test_job_is_dead_lettered_after_max_attempts_and_can_be_requeued() -> None:
    job_id = await add_job()
    calls: list[int] = []
    for _ in range(3):
        await make_due(job_id)
        await run_worker(handlers=recording(calls, ConnectionError()), worker_max_attempts=3)
    row = await job(job_id)
    assert calls == [job_id] * 3
    assert row.dead_at is not None  # type: ignore[attr-defined]
    assert row.attempts == 3  # type: ignore[attr-defined]
    await make_due(job_id)
    await run_worker(handlers=recording(calls), worker_max_attempts=3)
    assert calls == [job_id] * 3  # dead jobs are never claimed

    settings = worker_settings()
    dead = await cli.list_dead_jobs(settings)
    assert job_id in [d.id for d in dead]
    assert next(d for d in dead if d.id == job_id).last_error == "ConnectionError"
    await cli.requeue_job(settings, job_id)
    with pytest.raises(cli.CliError):
        await cli.requeue_job(settings, job_id)  # no longer dead
    await run_worker(handlers=recording(calls), worker_max_attempts=3)
    row = await job(job_id)
    assert row.processed_at is not None  # type: ignore[attr-defined]
    assert row.attempts == 1  # type: ignore[attr-defined]


async def test_unknown_topic_is_dead_lettered_immediately() -> None:
    job_id = await add_job(topic="email.not_handled")
    await run_worker(handlers={})
    row = await job(job_id)
    assert row.dead_at is not None  # type: ignore[attr-defined]
    assert row.last_error == "PermanentJobError"  # type: ignore[attr-defined]


async def test_cli_outbox_commands_need_the_worker_role() -> None:
    settings = worker_settings(worker_database_url=None)
    with pytest.raises(cli.CliError, match="WORKER_DATABASE_URL is required"):
        await cli.list_dead_jobs(settings)
    with pytest.raises(cli.CliError, match="WORKER_DATABASE_URL is required"):
        await cli.requeue_job(settings, 1)


# ----------------------------------------------------------------- at-least-once/leases
async def test_crash_before_ack_is_redelivered_after_the_lease_expires(
    worker_engine: AsyncEngine,
) -> None:
    job_id = await add_job()
    # A worker claims the job and "crashes" (never acks).
    async with AsyncSession(bind=worker_engine) as session, session.begin():
        [crashed] = await outbox.claim(session, batch=20, lease_seconds=300)
    assert crashed.id == job_id

    calls: list[int] = []
    await run_worker(handlers=recording(calls))
    assert calls == []  # still leased

    await superuser_sql(
        "UPDATE outbox SET locked_until = now() - interval '1 second' WHERE id = :id", id=job_id
    )
    await run_worker(handlers=recording(calls))
    assert calls == [job_id]
    row = await job(job_id)
    assert row.processed_at is not None  # type: ignore[attr-defined]
    assert row.attempts == 2  # type: ignore[attr-defined]

    # The crashed worker coming back cannot ack or fail the job it lost.
    async with AsyncSession(bind=worker_engine) as session, session.begin():
        assert not await outbox.ack(session, crashed)


async def test_concurrent_workers_never_claim_the_same_job(worker_engine: AsyncEngine) -> None:
    ids = {await add_job() for _ in range(30)}
    second_engine = create_async_engine(worker_engine.url, pool_size=1)
    gate = asyncio.Event()

    async def claim(engine: AsyncEngine) -> set[int]:
        async with AsyncSession(bind=engine) as session, session.begin():
            await gate.wait()
            claimed = await outbox.claim(session, batch=20, lease_seconds=300)
            await asyncio.sleep(0.2)  # hold the row locks while the other claims
            return {c.id for c in claimed}

    try:
        first = asyncio.create_task(claim(worker_engine))
        second = asyncio.create_task(claim(second_engine))
        gate.set()
        a, b = await asyncio.gather(first, second)
    finally:
        await second_engine.dispose()
    assert not a & b
    assert a | b == ids
    assert len(a) == 20 or len(b) == 20


async def test_job_claimed_too_often_without_ack_is_dead_lettered() -> None:
    job_id = await add_job()
    await superuser_sql("UPDATE outbox SET attempts = 3 WHERE id = :id", id=job_id)
    calls: list[int] = []
    await run_worker(handlers=recording(calls), worker_max_attempts=3)
    assert calls == []
    row = await job(job_id)
    assert row.dead_at is not None  # type: ignore[attr-defined]
    assert row.last_error == "lease_expired"  # type: ignore[attr-defined]


async def test_graceful_stop_releases_unstarted_jobs() -> None:
    job_id = await add_job()
    calls: list[int] = []
    assert await run_worker(handlers=recording(calls), stop_before_processing=True) == 1
    row = await job(job_id)
    assert calls == []
    assert row.attempts == 0  # type: ignore[attr-defined]
    assert row.locked_until is None  # type: ignore[attr-defined]
    assert row.processed_at is None  # type: ignore[attr-defined]


async def test_null_user_job_is_a_noop() -> None:
    [row] = await superuser_sql(
        "INSERT INTO outbox (topic, payload) VALUES ('email.password_reset', "
        "'{\"user_id\": null}') RETURNING id"
    )
    await run_worker()
    done = await job(int(row.id))
    assert done.processed_at is not None  # type: ignore[attr-defined]
    assert done.last_error is None  # type: ignore[attr-defined]
