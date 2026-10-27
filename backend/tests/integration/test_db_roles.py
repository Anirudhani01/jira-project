"""Runtime database-role safety (plan R3.1 / R9)."""

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.role_check import UnsafeDatabaseRoleError, inspect_current_role, verify_runtime_role


async def test_runtime_role_attributes_are_least_privileged(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        report = await inspect_current_role(conn)
    assert report.role_name == "app_rw"
    assert not report.is_superuser
    assert not report.bypass_rls
    assert not report.create_role
    assert not report.create_db
    assert report.owned_relations == 0
    assert not report.owns_database
    assert not report.can_create_in_public
    assert not report.member_of_owner
    assert report.violations() == []


async def test_verify_runtime_role_accepts_app_rw(rw_engine: AsyncEngine) -> None:
    assert await verify_runtime_role(rw_engine, enforce=True) == []


async def test_migration_role_is_rejected_for_runtime_use(owner_engine: AsyncEngine) -> None:
    with pytest.raises(UnsafeDatabaseRoleError) as excinfo:
        await verify_runtime_role(owner_engine, enforce=True)
    assert "owns_database" in excinfo.value.violations
    assert "owns_relations" in excinfo.value.violations


async def test_migration_role_violations_reported_without_enforcement(
    owner_engine: AsyncEngine,
) -> None:
    violations = await verify_runtime_role(owner_engine, enforce=False)
    assert violations


async def test_superuser_is_rejected_for_runtime_use(superuser_engine: AsyncEngine) -> None:
    with pytest.raises(UnsafeDatabaseRoleError) as excinfo:
        await verify_runtime_role(superuser_engine, enforce=True)
    assert "superuser" in excinfo.value.violations


async def test_runtime_role_cannot_create_tables(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text("CREATE TABLE m0_should_fail (id int)"))


async def test_runtime_role_cannot_touch_migration_state(rw_engine: AsyncEngine) -> None:
    for statement in (
        "SELECT version_num FROM alembic_version",
        "UPDATE alembic_version SET version_num = 'x'",
        "DELETE FROM alembic_version",
    ):
        async with rw_engine.connect() as conn:
            with pytest.raises(DBAPIError, match="permission denied"):
                await conn.execute(text(statement))


async def test_runtime_role_cannot_create_schema(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text("CREATE SCHEMA m0_should_fail"))
