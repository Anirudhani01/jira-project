"""Database-level identity controls: users RLS, event-store grants, dev CLI."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.cli import CliError, verify_user
from app.db.session import create_sessionmaker, transaction
from app.db.tenant import TenantContext, bind_auth_email, bind_tenant
from tests.integration.auth_support import (
    auth_client,
    flush_test_redis,
    integration_settings,
    signup,
    superuser_sql,
    unique_email,
)


async def _create_user() -> str:
    await flush_test_redis()
    email = unique_email()
    async with auth_client() as http:
        assert (await signup(http, email)).status_code == 202
    return email


# ------------------------------------------------------------------------- users RLS
async def test_users_invisible_without_context(rw_engine: AsyncEngine) -> None:
    await _create_user()
    async with rw_engine.connect() as conn:
        assert (await conn.execute(text("SELECT count(*) FROM users"))).scalar_one() == 0


async def test_auth_email_context_exposes_exactly_one_user(rw_engine: AsyncEngine) -> None:
    email = await _create_user()
    await _create_user()
    async with transaction(create_sessionmaker(rw_engine)) as session:
        await bind_auth_email(session, email.upper())  # citext comparison
        rows = (await session.execute(text("SELECT email FROM users"))).all()
    assert [r.email for r in rows] == [email]


async def test_user_context_exposes_only_self(rw_engine: AsyncEngine) -> None:
    email = await _create_user()
    await _create_user()
    ((user_id,),) = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
    async with transaction(create_sessionmaker(rw_engine)) as session:
        await bind_tenant(session, TenantContext(org_id=None, user_id=user_id))
        rows = (await session.execute(text("SELECT id FROM users"))).all()
        updated = await session.execute(text("UPDATE users SET display_name = 'Hacked'"))
    assert [r.id for r in rows] == [user_id]
    assert updated.rowcount == 1  # type: ignore[attr-defined]


async def test_insert_requires_matching_auth_email(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        await conn.execute(text("SELECT set_config('app.' || 'auth_email', 'a@x.io', true)"))
        with pytest.raises(DBAPIError, match="row-level security"):
            await conn.execute(
                text(
                    "INSERT INTO users (email, display_name, password_hash) "
                    "VALUES ('b@x.io', 'B', 'x')"
                )
            )


async def test_runtime_role_cannot_delete_users(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text("DELETE FROM users"))


# ---------------------------------------------------------------- security events store
async def test_runtime_role_cannot_read_or_modify_security_events(rw_engine: AsyncEngine) -> None:
    await _create_user()
    for statement in (
        "SELECT count(*) FROM security.platform_security_events",
        "UPDATE security.platform_security_events SET reason = 'x'",
        "DELETE FROM security.platform_security_events",
    ):
        async with rw_engine.connect() as conn:
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(text(statement))


async def test_security_reader_role_can_read_events() -> None:
    rows = await superuser_sql(
        "SELECT has_table_privilege('platform_security_reader', "
        "'security.platform_security_events', 'SELECT') AS can_read, "
        "has_table_privilege('platform_security_reader', "
        "'security.platform_security_events', 'INSERT') AS can_insert, "
        "has_table_privilege('app_rw', 'security.platform_security_events', 'INSERT') AS rw_insert"
    )
    assert rows[0].can_read is True
    assert rows[0].can_insert is False
    assert rows[0].rw_insert is True


async def test_sessions_store_only_token_hashes() -> None:
    rows = await superuser_sql(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'user_sessions'"
    )
    columns = {r.column_name for r in rows}
    assert "token_hash" in columns
    assert not columns & {"token", "csrf_token", "session_token"}


# ---------------------------------------------------------------------------- dev CLI
async def test_cli_verifies_user_in_test_environment() -> None:
    email = await _create_user()
    await verify_user(integration_settings(), email)
    ((verified,),) = await superuser_sql(
        "SELECT email_verified_at IS NOT NULL FROM users WHERE email = :e", e=email
    )
    assert verified is True
    events = await superuser_sql(
        "SELECT count(*) FROM security.platform_security_events e JOIN users u ON u.id = e.user_id "
        "WHERE u.email = :e AND e.event_type = 'user.verified_by_cli'",
        e=email,
    )
    assert events[0][0] == 1


@pytest.mark.parametrize("environment", ["staging", "prod"])
async def test_cli_refuses_outside_dev_and_test(environment: str) -> None:
    settings = integration_settings()
    settings.environment = environment  # bypass prod config validation for this check
    with pytest.raises(CliError, match="refusing to run"):
        await verify_user(settings, "anyone@example.com")


async def test_cli_unknown_email() -> None:
    with pytest.raises(CliError, match="no user"):
        await verify_user(integration_settings(), unique_email())
