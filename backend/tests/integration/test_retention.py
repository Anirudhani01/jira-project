"""M12: retention purge (plan V2.7 / D5): old rows go, fresh rows stay, the role is narrow,
and only one purge runs at a time."""

import asyncio
import os
import uuid
from collections.abc import AsyncIterator

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.worker.retention import RULES, run_purge
from tests.integration.auth_support import superuser_sql
from tests.integration.tenancy_support import denied
from tests.integration.test_comments import new_comment
from tests.integration.test_issues import Ctx
from tests.integration.test_notifications import created_by, team

pytest_plugins = ["tests.integration.test_notifications"]


@pytest.fixture
async def retention() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(os.environ["TEST_RETENTION_DATABASE_URL"], pool_size=3)
    yield engine
    await engine.dispose()


async def count(table: str, org: uuid.UUID | None = None, where: str = "true") -> int:
    scope = " AND org_id = :o" if org else ""
    [row] = await superuser_sql(
        f"SELECT count(*) AS n FROM {table} WHERE {where}{scope}",  # noqa: S608
        **({"o": org} if org else {}),
    )
    return int(row.n)


async def test_purge_deletes_only_rows_past_retention(ctx: Ctx, retention: AsyncEngine) -> None:
    org = ctx.tenant.org_id
    for days, action in ((400, "old"), (1, "fresh")):
        await superuser_sql(
            "INSERT INTO audit_events (org_id, action, outcome, created_at) "
            "VALUES (:o, :a, 'success', now() - make_interval(days => :days))",
            o=org,
            a=f"test.{action}",
            days=days,
        )
    await superuser_sql(
        "INSERT INTO security.platform_security_events (event_type, outcome, occurred_at) VALUES "
        "('test.old', 'success', now() - interval '13 months'), "
        "('test.fresh', 'success', now())"
    )
    a, _, _, b_id = await team(ctx)
    issue = await created_by(a, ctx, b_id)
    await new_comment(ctx.http, ctx.slug, issue["key"])
    await superuser_sql(
        "UPDATE notifications SET created_at = now() - interval '91 days' "
        "WHERE org_id = :o AND type = 'issue_assigned'",
        o=org,
    )
    await superuser_sql(
        "INSERT INTO idempotency_keys (org_id, user_id, key, request_hash, created_at, expires_at) "
        "VALUES "
        "(:o, :u, 'old-key', '\\x00', now() - interval '3 days', now() - interval '2 days'), "
        "(:o, :u, 'new-key', '\\x00', now(), now() + interval '1 day')",
        o=org,
        u=ctx.tenant.user_id,
    )

    totals = await run_purge(retention)

    assert totals is not None
    assert totals["audit_events"] >= 1
    assert await count("audit_events", org, "action = 'test.old'") == 0
    assert await count("audit_events", org, "action = 'test.fresh'") == 1
    assert await count("security.platform_security_events", where="event_type = 'test.old'") == 0
    assert await count("security.platform_security_events", where="event_type = 'test.fresh'") == 1
    assert await count("notifications", org, "type = 'issue_assigned'") == 0
    assert await count("notifications", org, "type = 'issue_commented'") >= 1
    assert await count("idempotency_keys", org, "key = 'old-key'") == 0
    assert await count("idempotency_keys", org, "key = 'new-key'") == 1


async def test_purge_batches_through_a_large_backlog(ctx: Ctx, retention: AsyncEngine) -> None:
    await superuser_sql(
        "INSERT INTO audit_events (org_id, action, outcome, created_at) "
        "SELECT :o, 'test.bulk', 'success', now() - interval '2 years' FROM generate_series(1, 25)",
        o=ctx.tenant.org_id,
    )
    totals = await run_purge(retention, batch=10)
    assert totals is not None
    assert totals["audit_events"] >= 25
    assert await count("audit_events", ctx.tenant.org_id, "action = 'test.bulk'") == 0


async def test_only_one_purge_runs_at_a_time(retention: AsyncEngine) -> None:
    results = await asyncio.gather(*[run_purge(retention) for _ in range(3)])
    assert any(r is not None for r in results)
    # The advisory lock is released afterwards, so a later purge runs normally.
    assert await run_purge(retention) is not None


async def test_the_retention_role_is_narrow_and_cannot_delete_fresh_rows(
    ctx: Ctx, retention: AsyncEngine
) -> None:
    org = ctx.tenant.org_id
    await superuser_sql(
        "INSERT INTO audit_events (org_id, action, outcome) VALUES (:o, 'test.keep', 'success')",
        o=org,
    )
    async with retention.begin() as connection:
        from sqlalchemy import text  # noqa: PLC0415

        await connection.execute(text("DELETE FROM audit_events"))
    assert await count("audit_events", org, "action = 'test.keep'") == 1
    for table in ("issues", "users", "org_memberships", "projects"):
        message = await denied(retention, f"SELECT 1 FROM {table}")  # noqa: S608
        assert "permission denied" in message
    update = await denied(retention, "UPDATE audit_events SET action = 'x'")
    assert "permission denied" in update


def test_every_purge_rule_targets_a_known_table() -> None:
    assert {r.table for r in RULES} == {
        "idempotency_keys",
        "user_tokens",
        "user_sessions",
        "notifications",
        "audit_events",
        "security.platform_security_events",
    }
