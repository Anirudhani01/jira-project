"""R3.5 test_rls_no_context and test_context_no_leak: without a bound context every tenant
table is empty and inserts are rejected; context never outlives its transaction, even on
the same pooled connection, after commit, rollback or an error."""

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.db.tenant import TenantContext, TenantContextError, bind_tenant, require_org_context
from app.modules.orgs import repository
from tests.integration.tenancy_support import Tenant, denied, rows

TABLES = ("organizations", "org_memberships", "issue_types", "priorities", "audit_events")


@pytest.mark.parametrize("table", TABLES)
async def test_no_context_sees_no_rows(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], table: str
) -> None:
    query = f"SELECT 1 FROM {table}"  # noqa: S608 - fixed table list
    assert await rows(rw_engine, query) == []


@pytest.mark.parametrize("table", TABLES)
async def test_user_only_context_sees_no_tenant_config_or_audit(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], table: str
) -> None:
    """With only a user bound (e.g. listing my orgs) config and audit stay hidden;
    organizations/memberships show only the user's own."""
    a, _ = two_tenants
    found = await rows(rw_engine, f"SELECT * FROM {table}", user_id=a.user_id)  # noqa: S608
    if table in ("issue_types", "priorities", "audit_events"):
        assert found == []
    else:
        assert found
        column = "id" if table == "organizations" else "org_id"
        assert {getattr(r, column) for r in found} == {a.org_id}


async def test_no_context_inserts_are_rejected(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    a, _ = two_tenants
    error = await denied(
        rw_engine,
        "INSERT INTO issue_types (org_id, name, kind, position) VALUES (:a, 'X', 'standard', 9)",
        a=a.org_id,
    )
    assert "row-level security" in error


@pytest.mark.parametrize("ending", ["commit", "rollback", "error"])
async def test_context_does_not_leak_to_the_next_transaction_on_the_same_connection(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], ending: str
) -> None:
    a, _ = two_tenants  # rw_engine has pool_size=1: both transactions share one connection
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_tenant(session, TenantContext(org_id=a.org_id, user_id=a.user_id))
        first_pid = (await session.execute(text("SELECT pg_backend_pid()"))).scalar_one()
        assert (await session.execute(text("SELECT count(*) FROM issue_types"))).scalar_one() == 5
        if ending == "error":
            with pytest.raises(Exception):  # noqa: B017, PT011 - any database error
                await session.execute(text("SELECT 1/0"))
            await session.rollback()
        elif ending == "commit":
            await session.commit()
        else:
            await session.rollback()
        with pytest.raises(TenantContextError):
            require_org_context(session)
    async with AsyncSession(bind=rw_engine) as session, session.begin():
        assert (await session.execute(text("SELECT pg_backend_pid()"))).scalar_one() == first_pid
        row = (
            await session.execute(text("SELECT app_current_org() AS o, app_current_user() AS u"))
        ).one()
        assert row.o is None
        assert row.u is None
        assert (await session.execute(text("SELECT count(*) FROM issue_types"))).scalar_one() == 0


async def test_tenant_repositories_refuse_to_run_without_a_bound_org(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    a, _ = two_tenants
    async with AsyncSession(bind=rw_engine) as session, session.begin():
        with pytest.raises(TenantContextError):
            await repository.list_issue_types(session)  # nothing bound
        await bind_tenant(session, TenantContext(org_id=None, user_id=a.user_id))
        with pytest.raises(TenantContextError):
            await repository.list_issue_types(session)  # user bound, no org
