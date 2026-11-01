"""A3.2 Phase 3: org auth reconciliation worker and cold-backlog fairness."""

from __future__ import annotations

import itertools
import os
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.worker.org_auth_reconciliation import ADVISORY_LOCK_KEY, run_org_auth_reconciliation
from tests.integration.email_support import run_worker, settle_outbox
from tests.integration.org_auth_projection_support import (
    AUTH_EVENT_TYPE,
    OrgAuthFixture,
    cleanup_fixture,
    create_user,
    get_function_definition,
    restore_function,
    superuser_exec,
    superuser_fetch,
)
from tests.integration.test_worker import add_job, job, make_due, recording

pytestmark = pytest.mark.integration

RECONCILE_DEF = "security.reconcile_org_auth_projections(int)"
BATCH = 100
AUTH_TYPES = (
    "auth.login.succeeded",
    "auth.login.failed",
    "auth.logout",
    "auth.password.changed",
    "auth.password_reset.requested",
    "auth.password.reset",
    "auth.session.revoked",
    "auth.rate_limited",
)


async def count_cold_gaps(*, user_id: uuid.UUID | None = None) -> int:
    user_filter = "AND p.user_id = :u" if user_id is not None else ""
    params: dict[str, object] = {}
    if user_id is not None:
        params["u"] = user_id
    types_sql = ", ".join(f"'{t}'" for t in AUTH_TYPES)
    [row] = await superuser_fetch(
        f"""
        SELECT count(*)::int AS n
        FROM security.platform_security_events p
        WHERE p.user_id IS NOT NULL
          AND p.event_type IN ({types_sql})
          AND p.occurred_at >= now() - interval '365 days'
          AND p.occurred_at < now() - interval '7 days'
          {user_filter}
          AND EXISTS (
            SELECT 1 FROM org_memberships m
            WHERE m.user_id = p.user_id
              AND app_user_was_org_member_at(m.org_id, p.user_id, p.occurred_at)
              AND NOT EXISTS (
                SELECT 1 FROM org_authentication_events o
                WHERE o.platform_event_id = p.id AND o.org_id = m.org_id
              )
          )
          AND NOT EXISTS (
            SELECT 1 FROM security.org_auth_projection_failures f
            WHERE f.platform_event_id = p.id AND f.permanent
          )
          AND (
            NOT EXISTS (
              SELECT 1 FROM security.org_auth_projection_failures f
              WHERE f.platform_event_id = p.id
            )
            OR EXISTS (
              SELECT 1 FROM security.org_auth_projection_failures f
              WHERE f.platform_event_id = p.id
                AND NOT f.permanent
                AND f.attempt_count < 5
                AND f.next_retry_at <= now()
            )
          )
        """,
        **params,
    )
    return int(row.n)


async def create_org_with_membership_since(
    *, user_id: uuid.UUID, member_since: datetime, slug_prefix: str = "a32-cold"
) -> uuid.UUID:
    org_id = uuid.uuid4()
    slug = f"{slug_prefix}-{uuid.uuid4().hex[:10]}"
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, slug, name, created_by) "
                    "VALUES (:o, :slug, 'Cold backlog org', :u)"
                ),
                {"o": org_id, "slug": slug, "u": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role, created_at) "
                    "VALUES (:o, :u, 'owner', :created)"
                ),
                {"o": org_id, "u": user_id, "created": member_since},
            )
    finally:
        await engine.dispose()
    return org_id


# --------------------------------------------------------------------- advisory lock
async def test_reconciliation_skips_when_another_session_holds_the_lock(
    worker_engine: AsyncEngine,
) -> None:
    peer = create_async_engine(os.environ["TEST_WORKER_DATABASE_URL"], pool_size=1)
    async with worker_engine.connect() as holder:
        locked = (
            await holder.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
            )
        ).scalar_one()
        await holder.commit()
        assert locked is True
        try:
            skipped = await run_org_auth_reconciliation(peer, batch=BATCH)
            assert skipped is None
        finally:
            await holder.execute(
                text("SELECT pg_advisory_unlock(:key)"), {"key": ADVISORY_LOCK_KEY}
            )
            await holder.commit()
    await peer.dispose()


async def test_reconciliation_releases_lock_after_completion(worker_engine: AsyncEngine) -> None:
    first = await run_org_auth_reconciliation(worker_engine, batch=BATCH)
    assert first is not None
    second = await run_org_auth_reconciliation(worker_engine, batch=BATCH)
    assert second is not None


async def test_reconciliation_releases_lock_after_sql_error(worker_engine: AsyncEngine) -> None:
    reconcile_def = await get_function_definition(RECONCILE_DEF)
    owner_engine = create_async_engine(os.environ["TEST_MIGRATION_DATABASE_URL"], pool_size=1)
    try:
        async with owner_engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    CREATE OR REPLACE FUNCTION security.reconcile_org_auth_projections(p_limit int)
                    RETURNS int
                    LANGUAGE plpgsql
                    SECURITY DEFINER
                    SET search_path = public, security, pg_temp
                    AS $$
                    BEGIN
                      RAISE EXCEPTION 'test reconcile failure' USING ERRCODE = 'P0001';
                    END;
                    $$
                    """
                )
            )
        with pytest.raises(Exception, match="test reconcile failure"):
            await run_org_auth_reconciliation(worker_engine, batch=BATCH)
    finally:
        await restore_function(reconcile_def)
        await owner_engine.dispose()
    after = await run_org_auth_reconciliation(worker_engine, batch=BATCH)
    assert after is not None


async def test_advisory_lock_released_when_session_ends_without_unlock(
    worker_engine: AsyncEngine,
) -> None:
    async with worker_engine.connect() as conn:
        locked = (
            await conn.execute(
                text("SELECT pg_try_advisory_lock(:key)"), {"key": ADVISORY_LOCK_KEY}
            )
        ).scalar_one()
        await conn.commit()
        assert locked is True
    resumed = await run_org_auth_reconciliation(worker_engine, batch=BATCH)
    assert resumed is not None


# --------------------------------------------------------------------- worker / outbox
async def test_reconciliation_errors_do_not_block_outbox_processing(
    worker_engine: AsyncEngine,
) -> None:
    """Outbox ``run_once`` and reconciliation share a role but not a failure domain."""
    await settle_outbox()
    job_id = await add_job()
    await make_due(job_id)
    calls: list[int] = []

    async def run_both() -> tuple[int, None]:
        outbox_claimed = await run_worker(handlers=recording(calls), stop_before_processing=False)
        with pytest.raises(Exception, match="reconcile down"):
            await run_org_auth_reconciliation(worker_engine, batch=BATCH)
        return outbox_claimed, None

    reconcile_def = await get_function_definition(RECONCILE_DEF)
    owner_engine = create_async_engine(os.environ["TEST_MIGRATION_DATABASE_URL"], pool_size=1)
    try:
        async with owner_engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    CREATE OR REPLACE FUNCTION security.reconcile_org_auth_projections(p_limit int)
                    RETURNS int
                    LANGUAGE plpgsql
                    SECURITY DEFINER
                    SET search_path = public, security, pg_temp
                    AS $$
                    BEGIN
                      RAISE EXCEPTION 'reconcile down' USING ERRCODE = 'P0001';
                    END;
                    $$
                    """
                )
            )
        claimed, _ = await run_both()
    finally:
        await restore_function(reconcile_def)
        await owner_engine.dispose()

    assert claimed >= 1
    assert calls == [job_id]
    row = await job(job_id)
    assert row.processed_at is not None  # type: ignore[attr-defined]


async def test_app_worker_cannot_call_privileged_projection_functions(
    worker_engine: AsyncEngine,
) -> None:
    async with worker_engine.connect() as conn:
        await conn.execute(text("SELECT security.reconcile_org_auth_projections(1)"))
        await conn.commit()
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text("SELECT security.apply_org_auth_projection(1)"))
        await conn.rollback()
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(
                text("SELECT security.operator_reset_org_auth_projection_failure(1, 'x')")
            )
        await conn.rollback()


# ---------------------------------------------------------------- cold-backlog fairness
async def test_cold_backlog_drains_with_hot_traffic(worker_engine: AsyncEngine) -> None:
    """Cold gap backlog > one batch, hot inserts during reconcile, DB state assertions."""
    cold_at = datetime.now(UTC) - timedelta(days=8)
    member_since = cold_at - timedelta(days=30)
    user_id = await create_user(display_name="Cold Hot User")
    org_id = await create_org_with_membership_since(user_id=user_id, member_since=member_since)
    platform_ids: list[int] = []
    hot_ids: list[int] = []
    try:
        await superuser_exec(
            "ALTER TABLE security.platform_security_events "
            "DISABLE TRIGGER org_auth_project_platform_event"
        )
        rows = await superuser_fetch(
            """
            INSERT INTO security.platform_security_events (event_type, outcome, user_id, occurred_at)
            SELECT :t, 'success', :u, :cold
            FROM generate_series(1, 120)
            RETURNING id
            """,
            t=AUTH_EVENT_TYPE,
            u=user_id,
            cold=cold_at,
        )
        platform_ids = [int(r.id) for r in rows]
        sample_cold_id = platform_ids[0]

        initial_cold = await count_cold_gaps(user_id=user_id)
        assert initial_cold > BATCH

        cold_counts: list[int] = [initial_cold]
        for cycle in range(8):
            if cycle % 2 == 0:
                [hot] = await superuser_fetch(
                    """
                    INSERT INTO security.platform_security_events
                    (event_type, outcome, user_id, occurred_at)
                    VALUES (:t, 'success', :u, now())
                    RETURNING id
                    """,
                    t=AUTH_EVENT_TYPE,
                    u=user_id,
                )
                hot_ids.append(int(hot.id))
                platform_ids.append(int(hot.id))
            applied = await run_org_auth_reconciliation(worker_engine, batch=BATCH)
            assert applied is not None
            cold_counts.append(await count_cold_gaps(user_id=user_id))

        for earlier, later in itertools.pairwise(cold_counts):
            assert later <= earlier

        assert cold_counts[-1] < initial_cold
        assert cold_counts[-1] < BATCH

        [cold_projection] = await superuser_fetch(
            "SELECT 1 AS ok FROM org_authentication_events "
            "WHERE platform_event_id = :p AND org_id = :o",
            p=sample_cold_id,
            o=org_id,
        )
        assert cold_projection.ok == 1

        assert hot_ids, "expected hot platform events during reconciliation cycles"
        [hot_projection] = await superuser_fetch(
            "SELECT count(*)::int AS n FROM org_authentication_events "
            "WHERE platform_event_id = ANY(:ids) AND org_id = :o",
            ids=hot_ids,
            o=org_id,
        )
        assert hot_projection.n == len(hot_ids)
    finally:
        await superuser_exec(
            "ALTER TABLE security.platform_security_events "
            "ENABLE TRIGGER org_auth_project_platform_event"
        )
        fix = OrgAuthFixture(user_id=user_id)
        fix.track_org(org_id)
        fix.platform_event_ids = platform_ids
        await cleanup_fixture(fix)
