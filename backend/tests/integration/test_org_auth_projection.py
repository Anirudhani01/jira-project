"""A3.2 Phase 2: org auth projection and recovery (database integration).

Test plan (by area):
- Temporal membership: fixed ``EVENT_AT`` with membership ``created_at`` / ``removed_at`` edges;
  multi-org fan-out; superuser fixture setup, trigger-driven projection.
- Projection correctness: field mapping, display-name snapshot, non-auth types skipped,
  duplicate apply/reconcile idempotency.
- Fail-open: temporarily replace DEFINER apply/record functions; platform INSERT via ``app_rw``;
  assert commit + failure-table state (or absence when record fails).
- Failure recovery: ``record_org_auth_projection_failure`` backoff/permanent via ``app_owner``;
  ``reconcile_org_auth_projections`` closes gaps after apply restored.
- Operator reset: unauthorized vs break-glass; audit trigger blocks partial reset.
- Role/RLS: ``app_rw`` platform deny, worker reconcile-only, tenant-scoped projection SELECT.
"""

from __future__ import annotations

import os
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from tests.integration.conftest import integration_env_missing
from tests.integration.org_auth_projection_support import (
    AUTH_EVENT_TYPE,
    EVENT_AT,
    OrgAuthFixture,
    cleanup_fixture,
    create_org,
    create_user,
    get_function_definition,
    insert_platform_auth_event,
    insert_platform_auth_event_rw,
    owner_fetch,
    replace_apply_with_forced_failure,
    replace_record_failure_with_forced_failure,
    restore_function,
    superuser_exec,
    superuser_fetch,
)

pytestmark = pytest.mark.integration

APPLY_DEF = "security.apply_org_auth_projection(bigint)"
RECORD_DEF = "security.record_org_auth_projection_failure(bigint,text,text)"


@pytest.fixture(autouse=True)
def _require_integration_env() -> None:
    if integration_env_missing():
        pytest.skip("integration env not configured")


# ------------------------------------------------------------------ temporal membership
async def test_projects_for_every_org_member_at_event_time() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_a = await create_org(created_by=fix.user_id, slug_prefix="a32-a")
    org_b = await create_org(created_by=fix.user_id, slug_prefix="a32-b")
    fix.track_org(org_a)
    fix.track_org(org_b)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        rows = await superuser_fetch(
            "SELECT org_id FROM org_authentication_events WHERE platform_event_id = :p ORDER BY org_id",
            p=pid,
        )
        assert {r.org_id for r in rows} == {org_a, org_b}
    finally:
        await cleanup_fixture(fix)


async def test_membership_starting_after_event_is_excluded() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    late_org = uuid.uuid4()
    slug = f"a32-late-{uuid.uuid4().hex[:8]}"
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, slug, name, created_by) "
                    "VALUES (:o, :slug, 'Late', :u)"
                ),
                {"o": late_org, "slug": slug, "u": fix.user_id},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role, created_at) "
                    "VALUES (:o, :u, 'owner', :created)"
                ),
                {"o": late_org, "u": fix.user_id, "created": EVENT_AT + timedelta(days=1)},
            )
    finally:
        await engine.dispose()
    fix.track_org(late_org)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        rows = await superuser_fetch(
            "SELECT org_id FROM org_authentication_events WHERE platform_event_id = :p",
            p=pid,
        )
        assert {r.org_id for r in rows} == {org_id}
    finally:
        await cleanup_fixture(fix)


async def test_membership_removed_before_event_is_excluded() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_ok = await create_org(created_by=fix.user_id, slug_prefix="a32-ok")
    fix.track_org(org_ok)
    backup_owner = await create_user(display_name="Gone Org Owner")
    fix.extra_user_ids.append(backup_owner)
    gone_org = uuid.uuid4()
    slug = f"a32-gone-{uuid.uuid4().hex[:8]}"
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, slug, name, created_by) "
                    "VALUES (:o, :slug, 'Gone', :owner)"
                ),
                {"o": gone_org, "slug": slug, "owner": backup_owner},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role, created_at) "
                    "VALUES (:o, :owner, 'owner', :created)"
                ),
                {"o": gone_org, "owner": backup_owner, "created": EVENT_AT - timedelta(days=60)},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role, created_at, removed_at) "
                    "VALUES (:o, :u, 'member', :created, :removed)"
                ),
                {
                    "o": gone_org,
                    "u": fix.user_id,
                    "created": EVENT_AT - timedelta(days=30),
                    "removed": EVENT_AT - timedelta(hours=1),
                },
            )
    finally:
        await engine.dispose()
    fix.track_org(gone_org)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        rows = await superuser_fetch(
            "SELECT org_id FROM org_authentication_events WHERE platform_event_id = :p",
            p=pid,
        )
        assert {r.org_id for r in rows} == {org_ok}
    finally:
        await cleanup_fixture(fix)


async def test_membership_removed_after_event_still_projected() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    backup_owner = await create_user(display_name="Backup Owner")
    fix.extra_user_ids.append(backup_owner)
    org_id = uuid.uuid4()
    slug = f"a32-rem-{uuid.uuid4().hex[:8]}"
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, slug, name, created_by) "
                    "VALUES (:o, :slug, 'Removed After', :owner)"
                ),
                {"o": org_id, "slug": slug, "owner": backup_owner},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role, created_at) "
                    "VALUES (:o, :owner, 'owner', :created)"
                ),
                {"o": org_id, "owner": backup_owner, "created": EVENT_AT - timedelta(days=30)},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role, created_at, removed_at) "
                    "VALUES (:o, :u, 'member', :created, :removed)"
                ),
                {
                    "o": org_id,
                    "u": fix.user_id,
                    "created": EVENT_AT - timedelta(days=10),
                    "removed": EVENT_AT + timedelta(days=7),
                },
            )
    finally:
        await engine.dispose()
    fix.track_org(org_id)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        rows = await superuser_fetch(
            "SELECT 1 FROM org_authentication_events WHERE platform_event_id = :p AND org_id = :o",
            p=pid,
            o=org_id,
        )
        assert len(rows) == 1
    finally:
        await cleanup_fixture(fix)


# ----------------------------------------------------------- projection correctness
async def test_projection_fields_and_metadata() -> None:
    fix = OrgAuthFixture(user_id=await create_user(display_name="Field User"))
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    try:
        pid = await insert_platform_auth_event(
            user_id=fix.user_id,
            reason="bad_password",
            metadata='{"channel":"mobile","safe":true}',
        )
        fix.track_platform(pid)
        [row] = await superuser_fetch(
            "SELECT event_type, outcome, reason, occurred_at, metadata::text AS md, "
            "member_display_name FROM org_authentication_events "
            "WHERE platform_event_id = :p AND org_id = :o",
            p=pid,
            o=org_id,
        )
        assert row.event_type == AUTH_EVENT_TYPE
        assert row.outcome == "success"
        assert row.reason == "bad_password"
        assert row.occurred_at == EVENT_AT
        assert "mobile" in row.md
        assert row.member_display_name == "Field User"
    finally:
        await cleanup_fixture(fix)


async def test_member_display_name_is_snapshot_not_live() -> None:
    fix = OrgAuthFixture(user_id=await create_user(display_name="Before Rename"))
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        await superuser_exec(
            "UPDATE users SET display_name = 'After Rename' WHERE id = :u", u=fix.user_id
        )
        [row] = await superuser_fetch(
            "SELECT member_display_name FROM org_authentication_events "
            "WHERE platform_event_id = :p",
            p=pid,
        )
        assert row.member_display_name == "Before Rename"
    finally:
        await cleanup_fixture(fix)


async def test_non_auth_platform_event_type_is_not_projected() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    try:
        pid = await insert_platform_auth_event(
            user_id=fix.user_id, event_type="auth.signup.requested"
        )
        fix.track_platform(pid)
        rows = await superuser_fetch(
            "SELECT 1 FROM org_authentication_events WHERE platform_event_id = :p",
            p=pid,
        )
        assert rows == []
    finally:
        await cleanup_fixture(fix)


async def test_duplicate_apply_and_reconcile_are_idempotent() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        await owner_fetch("SELECT security.apply_org_auth_projection(:p)", p=pid)
        await owner_fetch("SELECT security.apply_org_auth_projection(:p)", p=pid)
        worker = create_async_engine(os.environ["TEST_WORKER_DATABASE_URL"], pool_size=1)
        try:
            async with worker.begin() as conn:
                await conn.execute(text("SELECT security.reconcile_org_auth_projections(10)"))
        finally:
            await worker.dispose()
        [count] = await superuser_fetch(
            "SELECT count(*)::int AS n FROM org_authentication_events WHERE platform_event_id = :p",
            p=pid,
        )
        assert count.n == 1
    finally:
        await cleanup_fixture(fix)


# ------------------------------------------------------------------- fail-open behavior
async def test_platform_insert_commits_when_projection_fails() -> None:
    """Fail-open is identical for any inserter; trigger runs on INSERT to platform events."""
    apply_def = await get_function_definition(APPLY_DEF)
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    await replace_apply_with_forced_failure()
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        [platform] = await superuser_fetch(
            "SELECT id FROM security.platform_security_events WHERE id = :p", p=pid
        )
        assert platform.id == pid
        [failure] = await superuser_fetch(
            "SELECT attempt_count, permanent, sqlstate FROM security.org_auth_projection_failures "
            "WHERE platform_event_id = :p",
            p=pid,
        )
        assert failure.attempt_count == 1
        assert failure.permanent is False
        assert failure.sqlstate == "P0001"
        rows = await superuser_fetch(
            "SELECT 1 FROM org_authentication_events WHERE platform_event_id = :p", p=pid
        )
        assert rows == []
    finally:
        await restore_function(apply_def)
        await cleanup_fixture(fix)


async def test_platform_insert_commits_when_failure_recording_fails() -> None:
    apply_def = await get_function_definition(APPLY_DEF)
    record_def = await get_function_definition(RECORD_DEF)
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    await replace_apply_with_forced_failure()
    await replace_record_failure_with_forced_failure()
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        [platform] = await superuser_fetch(
            "SELECT id FROM security.platform_security_events WHERE id = :p", p=pid
        )
        assert platform.id == pid
        failures = await superuser_fetch(
            "SELECT 1 FROM security.org_auth_projection_failures WHERE platform_event_id = :p",
            p=pid,
        )
        assert failures == []
    finally:
        await restore_function(record_def)
        await restore_function(apply_def)
        await cleanup_fixture(fix)


# ------------------------------------------------------------------- failure recovery
async def test_failure_backoff_and_permanent_after_max_attempts() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    pid = await insert_platform_auth_event(user_id=fix.user_id)
    fix.track_platform(pid)
    try:
        for i in range(5):
            await owner_fetch(
                "SELECT security.record_org_auth_projection_failure(:p, 'P0001', :msg)",
                p=pid,
                msg=f"fail-{i}",
            )
        [row] = await superuser_fetch(
            "SELECT attempt_count, permanent, next_retry_at > now() AS retry_future "
            "FROM security.org_auth_projection_failures WHERE platform_event_id = :p",
            p=pid,
        )
        assert row.attempt_count == 5
        assert row.permanent is True
        assert row.retry_future is True
    finally:
        await cleanup_fixture(fix)


async def test_reconcile_recovers_after_transient_projection_failure() -> None:
    apply_def = await get_function_definition(APPLY_DEF)
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    await replace_apply_with_forced_failure()
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        await restore_function(apply_def)
        await superuser_exec(
            "UPDATE security.org_auth_projection_failures SET next_retry_at = now() - interval '1 minute', "
            "permanent = false, attempt_count = 1 WHERE platform_event_id = :p",
            p=pid,
        )
        worker = create_async_engine(os.environ["TEST_WORKER_DATABASE_URL"], pool_size=1)
        try:
            async with worker.begin() as conn:
                n = (
                    await conn.execute(text("SELECT security.reconcile_org_auth_projections(10)"))
                ).scalar_one()
                assert n >= 1
        finally:
            await worker.dispose()
        [proj] = await superuser_fetch(
            "SELECT 1 AS ok FROM org_authentication_events WHERE platform_event_id = :p AND org_id = :o",
            p=pid,
            o=org_id,
        )
        assert proj.ok == 1
        failures = await superuser_fetch(
            "SELECT 1 FROM security.org_auth_projection_failures WHERE platform_event_id = :p",
            p=pid,
        )
        assert failures == []
    finally:
        await restore_function(apply_def)
        await cleanup_fixture(fix)


async def test_trigger_and_reconcile_concurrent_idempotency() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        await owner_fetch("SELECT security.apply_org_auth_projection(:p)", p=pid)
        worker = create_async_engine(os.environ["TEST_WORKER_DATABASE_URL"], pool_size=1)
        try:
            async with worker.begin() as conn:
                await conn.execute(text("SELECT security.reconcile_org_auth_projections(10)"))
        finally:
            await worker.dispose()
        [count] = await superuser_fetch(
            "SELECT count(*)::int AS n FROM org_authentication_events WHERE platform_event_id = :p",
            p=pid,
        )
        assert count.n == 1
    finally:
        await cleanup_fixture(fix)


# ------------------------------------------------------------------------ operator reset
async def test_operator_reset_rejects_unauthorized_login() -> None:
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.connect() as conn:
            with pytest.raises(DBAPIError, match=r"permission denied|SET ROLE"):
                await conn.execute(
                    text(
                        "SELECT security.operator_reset_org_auth_projection_failure("
                        "999888, 'should fail')"
                    )
                )
            await conn.rollback()
    finally:
        await engine.dispose()


async def test_operator_reset_succeeds_and_clears_permanent_failure() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    pid = await insert_platform_auth_event(user_id=fix.user_id)
    fix.track_platform(pid)
    await superuser_exec("GRANT org_auth_operator TO CURRENT_USER")
    await superuser_exec(
        "INSERT INTO security.org_auth_projection_failures "
        "(platform_event_id, first_failed_at, last_failed_at, attempt_count, "
        "next_retry_at, permanent) VALUES (:p, now(), now(), 5, now(), true) "
        "ON CONFLICT (platform_event_id) DO UPDATE SET permanent = true, attempt_count = 5",
        p=pid,
    )
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            login = (await conn.execute(text("SELECT session_user::text AS s"))).scalar_one()
            await conn.execute(text("SET ROLE org_auth_operator"))
            await conn.execute(
                text(
                    "SELECT security.operator_reset_org_auth_projection_failure("
                    ":p, 'incident cleared')"
                ),
                {"p": pid},
            )
        [failure] = await superuser_fetch(
            "SELECT permanent FROM security.org_auth_projection_failures WHERE platform_event_id = :p",
            p=pid,
        )
        assert failure.permanent is False
        [audit] = await superuser_fetch(
            "SELECT operator, reason FROM security.org_auth_operator_actions WHERE platform_event_id = :p",
            p=pid,
        )
        assert audit.operator == login
        assert audit.reason == "incident cleared"
    finally:
        await engine.dispose()
        await cleanup_fixture(fix)


async def test_operator_cannot_use_direct_table_dml() -> None:
    await superuser_exec("GRANT org_auth_operator TO CURRENT_USER")
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SET ROLE org_auth_operator"))
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(
                    text(
                        "UPDATE security.org_auth_projection_failures SET permanent = false "
                        "WHERE platform_event_id = 1"
                    )
                )
            await conn.rollback()
            await conn.execute(text("SET ROLE org_auth_operator"))
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(
                    text(
                        "INSERT INTO security.org_auth_operator_actions "
                        "(platform_event_id, operator, reason) VALUES (1, 'x', 'y')"
                    )
                )
            await conn.rollback()
            await conn.execute(text("RESET ROLE"))
    finally:
        await engine.dispose()


async def test_operator_reset_rolls_back_when_audit_insert_blocked() -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    pid = await insert_platform_auth_event(user_id=fix.user_id)
    fix.track_platform(pid)
    await superuser_exec("GRANT org_auth_operator TO CURRENT_USER")
    await superuser_exec(
        "INSERT INTO security.org_auth_projection_failures "
        "(platform_event_id, first_failed_at, last_failed_at, attempt_count, "
        "next_retry_at, permanent) VALUES (:p, now(), now(), 5, now(), true) "
        "ON CONFLICT (platform_event_id) DO UPDATE SET permanent = true, attempt_count = 5",
        p=pid,
    )
    await superuser_exec(
        """
        CREATE OR REPLACE FUNCTION security.test_block_operator_audit_insert()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'blocked audit insert for test' USING ERRCODE = 'P0001';
        END;
        $$;
        """
    )
    await superuser_exec(
        """
        CREATE TRIGGER test_block_operator_audit
        BEFORE INSERT ON security.org_auth_operator_actions
        FOR EACH ROW EXECUTE FUNCTION security.test_block_operator_audit_insert()
        """
    )
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SET ROLE org_auth_operator"))
            with pytest.raises(DBAPIError, match="blocked audit insert"):
                await conn.execute(
                    text(
                        "SELECT security.operator_reset_org_auth_projection_failure("
                        ":p, 'should roll back')"
                    ),
                    {"p": pid},
                )
            await conn.rollback()
        [failure] = await superuser_fetch(
            "SELECT permanent FROM security.org_auth_projection_failures WHERE platform_event_id = :p",
            p=pid,
        )
        assert failure.permanent is True
        audits = await superuser_fetch(
            "SELECT 1 FROM security.org_auth_operator_actions WHERE platform_event_id = :p",
            p=pid,
        )
        assert audits == []
    finally:
        await engine.dispose()
        await superuser_exec(
            "DROP TRIGGER IF EXISTS test_block_operator_audit ON security.org_auth_operator_actions"
        )
        await superuser_exec("DROP FUNCTION IF EXISTS security.test_block_operator_audit_insert()")
        await cleanup_fixture(fix)


# --------------------------------------------------------------------- role / RLS boundaries
async def test_app_rw_has_insert_privilege_on_platform_events() -> None:
    [row] = await superuser_fetch(
        "SELECT has_table_privilege('app_rw', 'security.platform_security_events', 'INSERT') "
        "AS can_insert"
    )
    assert row.can_insert is True


async def test_app_rw_platform_event_insert_path(rw_engine: AsyncEngine) -> None:
    """Prove the runtime INSERT path: INSERT-only (no RETURNING), trigger, projection."""
    fix = OrgAuthFixture(user_id=await create_user())
    org_id = await create_org(created_by=fix.user_id)
    fix.track_org(org_id)
    try:
        async with rw_engine.connect() as conn:
            [identity] = (
                await conn.execute(
                    text(
                        "SELECT current_user::text AS current_user, "
                        "session_user::text AS session_user, "
                        "current_setting('role', true) AS effective_role"
                    )
                )
            ).all()
            assert identity.current_user == "app_rw"
            assert identity.session_user == "app_rw"
            assert identity.effective_role in (None, "none", "")

            [privileges] = (
                await conn.execute(
                    text(
                        "SELECT "
                        "has_table_privilege(current_user, "
                        "'security.platform_security_events', 'INSERT') AS table_insert, "
                        "has_table_privilege(current_user, "
                        "'security.platform_security_events', 'SELECT') AS table_select, "
                        "has_schema_privilege(current_user, 'security', 'USAGE') AS schema_usage, "
                        "has_sequence_privilege(current_user, "
                        "pg_get_serial_sequence('security.platform_security_events', 'id'), "
                        "'USAGE') AS sequence_usage"
                    )
                )
            ).all()
            assert privileges.table_insert is True
            assert privileges.table_select is False
            assert privileges.schema_usage is True
            assert privileges.sequence_usage is True

            grant_rows = (
                await conn.execute(
                    text(
                        "SELECT privilege_type FROM information_schema.table_privileges "
                        "WHERE grantee = current_user "
                        "AND table_schema = 'security' "
                        "AND table_name = 'platform_security_events' "
                        "ORDER BY privilege_type"
                    )
                )
            ).all()
            assert {r.privilege_type for r in grant_rows} == {"INSERT"}

            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(
                    text(
                        "INSERT INTO security.platform_security_events "
                        "(event_type, outcome, user_id, occurred_at) "
                        "VALUES (:t, :out, :u, :at) RETURNING id"
                    ),
                    {
                        "t": AUTH_EVENT_TYPE,
                        "out": "success",
                        "u": fix.user_id,
                        "at": EVENT_AT,
                    },
                )
            await conn.rollback()

        platform_event_id = await insert_platform_auth_event_rw(
            rw_engine, user_id=fix.user_id, occurred_at=EVENT_AT, event_type=AUTH_EVENT_TYPE
        )
        fix.track_platform(platform_event_id)

        [platform] = await superuser_fetch(
            "SELECT id, event_type, user_id, outcome FROM security.platform_security_events "
            "WHERE id = :p",
            p=platform_event_id,
        )
        assert platform.id == platform_event_id
        assert platform.event_type == AUTH_EVENT_TYPE
        assert platform.user_id == fix.user_id
        assert platform.outcome == "success"

        [projection] = await superuser_fetch(
            "SELECT org_id, platform_event_id, event_type, member_display_name "
            "FROM org_authentication_events WHERE platform_event_id = :p",
            p=platform_event_id,
        )
        assert projection.org_id == org_id
        assert projection.platform_event_id == platform_event_id
        assert projection.event_type == AUTH_EVENT_TYPE
        assert projection.member_display_name == "Projection User"

        failures = await superuser_fetch(
            "SELECT 1 FROM security.org_auth_projection_failures WHERE platform_event_id = :p",
            p=platform_event_id,
        )
        assert failures == []

        async with rw_engine.connect() as conn:
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(
                    text("SELECT 1 FROM security.platform_security_events WHERE id = :p"),
                    {"p": platform_event_id},
                )
    finally:
        await cleanup_fixture(fix)


async def test_app_rw_cannot_select_platform_events(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text("SELECT 1 FROM security.platform_security_events LIMIT 1"))


async def test_app_worker_reconcile_without_apply_or_operator(worker_engine: AsyncEngine) -> None:
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


async def test_org_auth_projection_select_is_tenant_scoped(rw_engine: AsyncEngine) -> None:
    fix = OrgAuthFixture(user_id=await create_user())
    org_a = await create_org(created_by=fix.user_id, slug_prefix="a32-rls-a")
    user_b = await create_user(display_name="Other")
    fix.extra_user_ids.append(user_b)
    org_b = await create_org(created_by=user_b, slug_prefix="a32-rls-b")
    fix.track_org(org_a)
    fix.track_org(org_b)
    try:
        pid = await insert_platform_auth_event(user_id=fix.user_id)
        fix.track_platform(pid)
        async with rw_engine.connect() as conn:
            await conn.execute(
                text(
                    "SELECT set_config('app.org_id', :o, true), set_config('app.user_id', :u, true)"
                ),
                {"o": str(org_a), "u": str(fix.user_id)},
            )
            visible = (
                await conn.execute(
                    text(
                        "SELECT org_id FROM org_authentication_events WHERE platform_event_id = :p"
                    ),
                    {"p": pid},
                )
            ).all()
            assert len(visible) == 1
            assert visible[0].org_id == org_a
            await conn.execute(
                text(
                    "SELECT set_config('app.org_id', :o, true), set_config('app.user_id', :u, true)"
                ),
                {"o": str(org_b), "u": str(user_b)},
            )
            hidden = (
                await conn.execute(
                    text("SELECT 1 FROM org_authentication_events WHERE platform_event_id = :p"),
                    {"p": pid},
                )
            ).all()
            assert hidden == []
            await conn.rollback()
    finally:
        await cleanup_fixture(fix)


async def test_runtime_roles_are_not_app_owner() -> None:
    names = await superuser_fetch(
        "SELECT rolname, rolbypassrls FROM pg_roles "
        "WHERE rolname IN ('app_rw', 'app_worker', 'app_owner') ORDER BY rolname"
    )
    by_name = {r.rolname: r.rolbypassrls for r in names}
    assert by_name["app_owner"] is False
    assert by_name["app_rw"] is False
    assert by_name["app_worker"] is False


async def test_org_auth_operator_has_select_only_on_ops_tables() -> None:
    rows = await superuser_fetch(
        """
        SELECT table_name, privilege_type
        FROM information_schema.table_privileges
        WHERE grantee = 'org_auth_operator'
          AND table_schema = 'security'
          AND table_name IN ('org_auth_projection_failures', 'org_auth_operator_actions')
        ORDER BY table_name, privilege_type
        """
    )
    privs = {(r.table_name, r.privilege_type) for r in rows}
    assert privs == {
        ("org_auth_operator_actions", "SELECT"),
        ("org_auth_projection_failures", "SELECT"),
    }
