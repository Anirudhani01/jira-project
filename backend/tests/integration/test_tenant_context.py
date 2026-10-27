"""Tenant-context helpers and binding (plan R3.1 fail-closed context)."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.session import create_sessionmaker, transaction
from app.db.tenant import TenantContext, TenantContextError, bind_tenant

READ_CONTEXT = text("SELECT app_current_org() AS org_id, app_current_user() AS user_id")


async def test_helpers_return_null_without_context(rw_engine: AsyncEngine) -> None:
    async with rw_engine.connect() as conn:
        row = (await conn.execute(READ_CONTEXT)).one()
    assert row.org_id is None
    assert row.user_id is None


async def test_bound_context_is_visible_inside_the_transaction(rw_engine: AsyncEngine) -> None:
    org_id, user_id = uuid.uuid4(), uuid.uuid4()
    async with transaction(create_sessionmaker(rw_engine)) as session:
        await bind_tenant(session, TenantContext(org_id=org_id, user_id=user_id))
        row = (await session.execute(READ_CONTEXT)).one()
    assert row.org_id == org_id
    assert row.user_id == user_id


async def test_user_only_context_leaves_org_null(rw_engine: AsyncEngine) -> None:
    user_id = uuid.uuid4()
    async with transaction(create_sessionmaker(rw_engine)) as session:
        await bind_tenant(session, TenantContext(org_id=None, user_id=user_id))
        row = (await session.execute(READ_CONTEXT)).one()
    assert row.org_id is None
    assert row.user_id == user_id


@pytest.mark.parametrize("outcome", ["commit", "rollback"])
async def test_context_does_not_leak_to_next_transaction_on_same_connection(
    rw_engine: AsyncEngine, outcome: str
) -> None:
    sessionmaker = create_sessionmaker(rw_engine)  # pool_size=1: same physical connection
    with pytest.raises(RuntimeError) if outcome == "rollback" else _nullcontext():
        async with transaction(sessionmaker) as session:
            await bind_tenant(session, TenantContext(org_id=uuid.uuid4(), user_id=uuid.uuid4()))
            if outcome == "rollback":
                raise RuntimeError("force rollback")
    async with transaction(sessionmaker) as session:
        row = (await session.execute(READ_CONTEXT)).one()
    assert row.org_id is None
    assert row.user_id is None


async def test_binding_requires_explicit_transaction(rw_engine: AsyncEngine) -> None:
    async with create_sessionmaker(rw_engine)() as session:
        with pytest.raises(TenantContextError, match="explicit transaction"):
            await bind_tenant(session, TenantContext(org_id=uuid.uuid4(), user_id=None))


async def test_binding_requires_some_identity(rw_engine: AsyncEngine) -> None:
    async with transaction(create_sessionmaker(rw_engine)) as session:
        with pytest.raises(TenantContextError):
            await bind_tenant(session, TenantContext(org_id=None, user_id=None))


async def test_malformed_setting_fails_closed(rw_engine: AsyncEngine) -> None:
    """A non-UUID value errors instead of silently matching anything."""
    async with rw_engine.connect() as conn:
        await conn.execute(text("SELECT set_config('app.' || 'org_id', 'not-a-uuid', true)"))
        with pytest.raises(Exception, match="invalid input syntax for type uuid"):
            await conn.execute(READ_CONTEXT)


class _nullcontext:  # noqa: N801 - mirrors contextlib.nullcontext for the parametrized raises
    def __enter__(self) -> None:
        return None

    def __exit__(self, *exc: object) -> None:
        return None
