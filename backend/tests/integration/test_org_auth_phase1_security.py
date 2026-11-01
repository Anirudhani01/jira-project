"""A3.2 Phase 1: migration security (operator identity, missing-source, privileges).

Phase 3 cold-backlog fairness is covered in ``test_org_auth_reconciliation_worker.py``; it must assert:
- Continuous insertion of new hot platform events during the test window.
- A cold gap backlog strictly larger than one reconcile batch (``p_limit``).
- Multiple ``reconcile_org_auth_projections`` invocations under advisory lock discipline.
- Monotonic decrease of the cold-gap count across runs.
- At least one previously cold ``platform_event_id`` becomes fully projected.
"""

import os
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from tests.integration.auth_support import superuser_sql
from tests.integration.conftest import integration_env_missing
from tests.integration.org_auth_projection_support import synthetic_platform_event_id

pytestmark = pytest.mark.integration


async def test_security_definer_current_user_is_function_owner_not_set_role() -> None:
    """Inside SECURITY DEFINER, current_user is the owner (app_owner), not SET ROLE."""
    await superuser_sql("GRANT org_auth_operator TO CURRENT_USER")
    await superuser_sql("DROP FUNCTION IF EXISTS security.test_definer_identity()")
    owner_engine = create_async_engine(os.environ["TEST_MIGRATION_DATABASE_URL"], pool_size=1)
    try:
        async with owner_engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    CREATE OR REPLACE FUNCTION security.test_definer_identity()
                    RETURNS TABLE(definer_user name, login_user name)
                    LANGUAGE sql
                    SECURITY DEFINER
                    SET search_path = public, security, pg_temp
                    AS $$ SELECT current_user, session_user $$
                    """
                )
            )
            await conn.execute(
                text("REVOKE ALL ON FUNCTION security.test_definer_identity() FROM PUBLIC")
            )
            await conn.execute(
                text(
                    "GRANT EXECUTE ON FUNCTION security.test_definer_identity() TO org_auth_operator"
                )
            )
    finally:
        await owner_engine.dispose()
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.connect() as conn:
            before = (await conn.execute(text("SELECT current_user::text AS u"))).scalar_one()
            await conn.execute(text("SET ROLE org_auth_operator"))
            row = (await conn.execute(text("SELECT * FROM security.test_definer_identity()"))).one()
            assert row.definer_user == "app_owner"
            assert row.login_user == before
            await conn.execute(text("RESET ROLE"))
            await conn.commit()
    finally:
        await engine.dispose()
    await superuser_sql("DROP FUNCTION security.test_definer_identity()")


async def _superuser_exec(statement: str, **params: object) -> None:
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(statement), params)
    finally:
        await engine.dispose()


@pytest.fixture(autouse=True)
def _require_integration_env() -> None:
    if integration_env_missing():
        pytest.skip("integration env not configured")


async def test_app_rw_cannot_read_platform_security_events(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text("SELECT 1 FROM security.platform_security_events LIMIT 1"))


async def test_app_rw_cannot_execute_privileged_org_auth_functions(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        for stmt in (
            "SELECT security.apply_org_auth_projection(1)",
            "SELECT security.reconcile_org_auth_projections(10)",
            "SELECT security.operator_reset_org_auth_projection_failure(1, 'x')",
        ):
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(text(stmt))
            await conn.rollback()


async def test_app_worker_can_execute_reconcile_only(worker_engine: AsyncEngine) -> None:
    async with worker_engine.connect() as conn:
        await conn.execute(text("SELECT security.reconcile_org_auth_projections(1)"))
        await conn.commit()
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(
                text("SELECT security.operator_reset_org_auth_projection_failure(1, 'x')")
            )
        await conn.rollback()
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text("SELECT security.apply_org_auth_projection(1)"))
        await conn.rollback()


async def test_app_worker_cannot_read_operator_tables(worker_engine: AsyncEngine) -> None:
    async with worker_engine.connect() as conn:
        for table in (
            "security.org_auth_projection_failures",
            "security.org_auth_operator_actions",
            "security.org_auth_missing_source_inconsistencies",
        ):
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(text(f"SELECT 1 FROM {table} LIMIT 1"))
            await conn.rollback()


async def test_operator_reset_denied_without_set_role() -> None:
    await _superuser_exec("GRANT org_auth_operator TO CURRENT_USER")
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.connect() as conn:
            await conn.execute(
                text(
                    "INSERT INTO security.org_auth_projection_failures "
                    "(platform_event_id, first_failed_at, last_failed_at, attempt_count, "
                    f"next_retry_at, permanent) VALUES ({synthetic_platform_event_id(999001)}, now(), now(), 5, now(), true) "
                    "ON CONFLICT (platform_event_id) DO UPDATE SET permanent = true, attempt_count = 5"
                )
            )
            await conn.commit()
            with pytest.raises(DBAPIError, match="SET ROLE org_auth_operator is required"):
                await conn.execute(
                    text(
                        "SELECT security.operator_reset_org_auth_projection_failure("
                        f"{synthetic_platform_event_id(999001)}, 'incident review')"
                    )
                )
            await conn.rollback()
            await conn.execute(
                text(
                    f"DELETE FROM security.org_auth_projection_failures WHERE platform_event_id = {synthetic_platform_event_id(999001)}"
                )
            )
            await conn.commit()
    finally:
        await engine.dispose()


async def test_operator_cannot_bypass_reset_with_direct_table_dml() -> None:
    """Operators have SELECT-only on ops tables; reset must go through the audited function."""
    await _superuser_exec("GRANT org_auth_operator TO CURRENT_USER")
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.connect() as conn:
            await conn.execute(
                text(
                    "INSERT INTO security.org_auth_projection_failures "
                    "(platform_event_id, first_failed_at, last_failed_at, attempt_count, "
                    f"next_retry_at, permanent) VALUES ({synthetic_platform_event_id(999003)}, now(), now(), 5, now(), true) "
                    "ON CONFLICT (platform_event_id) DO UPDATE SET permanent = true, attempt_count = 5"
                )
            )
            await conn.commit()
            await conn.execute(text("SET ROLE org_auth_operator"))
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(
                    text(
                        "UPDATE security.org_auth_projection_failures SET permanent = false "
                        f"WHERE platform_event_id = {synthetic_platform_event_id(999003)}"
                    )
                )
            await conn.rollback()
            await conn.execute(text("SET ROLE org_auth_operator"))
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(
                    text(
                        "INSERT INTO security.org_auth_operator_actions "
                        f"(platform_event_id, operator, reason) VALUES ({synthetic_platform_event_id(999003)}, 'evil', 'forged')"
                    )
                )
            await conn.rollback()
            await conn.execute(text("RESET ROLE"))
            await conn.execute(
                text(
                    f"DELETE FROM security.org_auth_projection_failures WHERE platform_event_id = {synthetic_platform_event_id(999003)}"
                )
            )
            await conn.commit()
    finally:
        await engine.dispose()


async def test_operator_reset_succeeds_with_set_role_and_records_session_user() -> None:
    await _superuser_exec("GRANT org_auth_operator TO CURRENT_USER")
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            login = (
                await conn.execute(text("SELECT current_user::text AS u, session_user::text AS s"))
            ).one()
            await conn.execute(
                text(
                    "INSERT INTO security.org_auth_projection_failures "
                    "(platform_event_id, first_failed_at, last_failed_at, attempt_count, "
                    f"next_retry_at, permanent) VALUES ({synthetic_platform_event_id(999002)}, now(), now(), 5, now(), true) "
                    "ON CONFLICT (platform_event_id) DO UPDATE SET permanent = true, attempt_count = 5"
                )
            )
            await conn.execute(text("SET ROLE org_auth_operator"))
            await conn.execute(
                text(
                    "SELECT security.operator_reset_org_auth_projection_failure("
                    f"{synthetic_platform_event_id(999002)}, 'manual recovery after incident')"
                )
            )
            row = (
                await conn.execute(
                    text(
                        "SELECT operator, reason FROM security.org_auth_operator_actions "
                        f"WHERE platform_event_id = {synthetic_platform_event_id(999002)}"
                    )
                )
            ).one()
            assert row.operator == login.s
            assert row.reason == "manual recovery after incident"
            failure = (
                await conn.execute(
                    text(
                        "SELECT permanent FROM security.org_auth_projection_failures "
                        f"WHERE platform_event_id = {synthetic_platform_event_id(999002)}"
                    )
                )
            ).scalar_one()
            assert failure is False
    finally:
        await engine.dispose()
    await _superuser_exec(
        f"DELETE FROM security.org_auth_operator_actions WHERE platform_event_id = {synthetic_platform_event_id(999002)}"
    )
    await _superuser_exec(
        f"DELETE FROM security.org_auth_projection_failures WHERE platform_event_id = {synthetic_platform_event_id(999002)}"
    )


async def _insert_missing_source_orphan(
    *,
    platform_event_id: int,
    occurred_interval: str,
) -> tuple[uuid.UUID, uuid.UUID, int]:
    """User, org, membership, and orphan projection (no matching platform row)."""
    user_id = uuid.uuid4()
    org_id = uuid.uuid4()
    slug = f"a32-{uuid.uuid4().hex[:10]}"
    email = f"a32-{user_id.hex[:12]}@example.com"
    if occurred_interval not in ("1 day", "400 days"):
        raise ValueError("unsupported occurred_interval")
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, display_name, password_hash) "
                    "VALUES (:u, :e, 'A32 Missing Source', 'x')"
                ),
                {"u": user_id, "e": email},
            )
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, slug, name, created_by) "
                    "VALUES (:o, :slug, 'A32 Missing Source Org', :u)"
                ),
                {"o": org_id, "slug": slug, "u": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:o, :u, 'owner')"
                ),
                {"o": org_id, "u": user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO security.platform_security_events "
                    "(event_type, outcome, user_id, occurred_at) "
                    "VALUES ('auth.login.succeeded', 'success', :u, now() - interval '1 day')"
                ),
                {"u": user_id},
            )
            projection_id = (
                await conn.execute(
                    text(
                        "INSERT INTO org_authentication_events (org_id, user_id, platform_event_id, "
                        "event_type, outcome, member_display_name, occurred_at) "
                        "VALUES (:o, :u, :pe, 'auth.login.succeeded', 'success', 'A32 Missing Source', "
                        f"now() - interval '{occurred_interval}') RETURNING id"
                    ),
                    {"o": org_id, "u": user_id, "pe": platform_event_id},
                )
            ).scalar_one()
    finally:
        await engine.dispose()
    return org_id, user_id, projection_id


async def _cleanup_missing_source_fixture(
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    projection_id: int,
) -> None:
    await superuser_sql(
        "DELETE FROM security.org_auth_missing_source_inconsistencies WHERE projection_id = :id",
        id=projection_id,
    )
    await superuser_sql("DELETE FROM org_authentication_events WHERE id = :id", id=projection_id)
    await superuser_sql(
        "DELETE FROM security.platform_security_events WHERE user_id = :u", u=user_id
    )
    await superuser_sql(
        "DELETE FROM org_memberships WHERE org_id = :o AND user_id = :u", o=org_id, u=user_id
    )
    await superuser_sql("DELETE FROM organizations WHERE id = :o", o=org_id)
    await superuser_sql("DELETE FROM users WHERE id = :u", u=user_id)


async def test_detect_missing_source_flags_recent_orphan() -> None:
    platform_event_id = synthetic_platform_event_id(888001)
    org_id, user_id, projection_id = await _insert_missing_source_orphan(
        platform_event_id=platform_event_id,
        occurred_interval="1 day",
    )
    try:
        first = await superuser_sql("SELECT security.detect_org_auth_missing_sources() AS n")
        assert first[0].n >= 1
        rows = await superuser_sql(
            "SELECT projection_id FROM security.org_auth_missing_source_inconsistencies "
            "WHERE projection_id = :id",
            id=projection_id,
        )
        assert len(rows) == 1

        second = await superuser_sql("SELECT security.detect_org_auth_missing_sources() AS n")
        assert second[0].n == 0
        rows_again = await superuser_sql(
            "SELECT projection_id FROM security.org_auth_missing_source_inconsistencies "
            "WHERE projection_id = :id",
            id=projection_id,
        )
        assert len(rows_again) == 1
    finally:
        await _cleanup_missing_source_fixture(
            org_id=org_id, user_id=user_id, projection_id=projection_id
        )


async def test_detect_missing_source_skips_retention_expired_projection() -> None:
    platform_event_id = synthetic_platform_event_id(888002)
    org_id, user_id, projection_id = await _insert_missing_source_orphan(
        platform_event_id=platform_event_id,
        occurred_interval="400 days",
    )
    try:
        before = await superuser_sql("SELECT security.detect_org_auth_missing_sources() AS n")
        rows = await superuser_sql(
            "SELECT 1 FROM security.org_auth_missing_source_inconsistencies WHERE projection_id = :id",
            id=projection_id,
        )
        assert rows == []
        assert before[0].n == 0

        again = await superuser_sql("SELECT security.detect_org_auth_missing_sources() AS n")
        assert again[0].n == 0
    finally:
        await _cleanup_missing_source_fixture(
            org_id=org_id, user_id=user_id, projection_id=projection_id
        )
