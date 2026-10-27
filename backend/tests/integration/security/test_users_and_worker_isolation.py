"""R3.5 test_users_visibility and test_worker_isolation (restricted roles only)."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.auth_support import auth_client, flush_test_redis, superuser_sql
from tests.integration.tenancy_support import Tenant, add_member, denied, rows, verified_user

USERS = "SELECT id FROM users"


async def test_users_visible_only_to_self_and_active_co_members(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    a, b = two_tenants
    await flush_test_redis()
    async with auth_client() as http:
        _, colleague = await verified_user(http)
    await add_member(a.org_id, colleague)

    in_a = {r.id for r in await rows(rw_engine, USERS, org_id=a.org_id, user_id=a.user_id)}
    assert in_a == {a.user_id, colleague}
    assert b.user_id not in in_a
    # Without an org bound, only the user themself.
    assert {r.id for r in await rows(rw_engine, USERS, user_id=a.user_id)} == {a.user_id}
    # Forged binding to an org the user does not belong to: only self.
    forged = await rows(rw_engine, USERS, org_id=b.org_id, user_id=a.user_id)
    assert {r.id for r in forged} == {a.user_id}
    # A removed member is no longer visible to the others.
    await superuser_sql(
        "UPDATE org_memberships SET removed_at = now() WHERE org_id = :o AND user_id = :u",
        o=a.org_id,
        u=colleague,
    )
    assert {r.id for r in await rows(rw_engine, USERS, org_id=a.org_id, user_id=a.user_id)} == {
        a.user_id
    }


async def test_worker_bound_to_one_org_reads_only_that_org(
    worker_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    a, b = two_tenants
    orgs = await rows(worker_engine, "SELECT id FROM organizations", org_id=a.org_id)
    assert {r.id for r in orgs} == {a.org_id}
    members = await rows(worker_engine, "SELECT org_id FROM org_memberships", org_id=a.org_id)
    assert {r.org_id for r in members} == {a.org_id}
    assert (
        await rows(
            worker_engine, "SELECT 1 FROM organizations WHERE id = :b", org_id=a.org_id, b=b.org_id
        )
        == []
    )
    # No bound org: nothing.
    assert await rows(worker_engine, "SELECT 1 FROM organizations") == []
    assert await rows(worker_engine, "SELECT 1 FROM org_memberships") == []


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE organizations SET name = 'x' WHERE id = :a",
        "INSERT INTO organizations (id, slug, name, created_by) "
        "VALUES (:x, 'worker-probe', 'x', :u)",
        "UPDATE org_memberships SET role = 'owner' WHERE org_id = :a",
        "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:a, :u, 'owner')",
        "DELETE FROM org_memberships",
        "SELECT 1 FROM issue_types",
        "SELECT 1 FROM priorities",
        "SELECT 1 FROM audit_events",
        "INSERT INTO audit_events (org_id, action, outcome) VALUES (:a, 'org.updated', 'success')",
    ],
)
async def test_worker_cannot_write_tenant_tables_or_read_config_and_audit(
    worker_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], statement: str
) -> None:
    a, _ = two_tenants
    error = await denied(
        worker_engine, statement, org_id=a.org_id, a=a.org_id, u=a.user_id, x=uuid.uuid4()
    )
    assert "permission denied" in error
