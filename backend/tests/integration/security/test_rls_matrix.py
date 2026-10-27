"""R3.5 test_rls_matrix: as ``app_rw`` with org A bound (and A's owner as user), org B's
rows are invisible, inserts and updates into B are rejected and B rows cannot be changed
or deleted. Every assertion runs as the restricted runtime role."""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.tenancy_support import Tenant, affected, checksum, denied, rows

COUNT_B = {
    "organizations": "SELECT id FROM organizations WHERE id = :b",
    "org_memberships": "SELECT org_id FROM org_memberships WHERE org_id = :b",
    "issue_types": "SELECT id FROM issue_types WHERE org_id = :b",
    "priorities": "SELECT id FROM priorities WHERE org_id = :b",
    "audit_events": "SELECT id FROM audit_events WHERE org_id = :b",
}
INSERT_INTO_B = {
    "org_memberships": (
        "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:b, :me, 'owner')"
    ),
    "issue_types": (
        "INSERT INTO issue_types (org_id, name, kind, position) VALUES (:b, 'X', 'standard', 9)"
    ),
    "priorities": (
        "INSERT INTO priorities (org_id, name, sort_order, color) VALUES (:b, 'X', 9, '#000000')"
    ),
    "audit_events": (
        "INSERT INTO audit_events (org_id, actor_user_id, action, outcome) "
        "VALUES (:b, :me, 'org.updated', 'success')"
    ),
    "outbox": "INSERT INTO outbox (org_id, topic, payload) VALUES (:b, 'email.verify', '{}')",
    # A new org whose id is not the bound org (and therefore not creatable).
    "organizations": (
        "INSERT INTO organizations (id, slug, name, created_by) VALUES (:b2, :slug, 'X', :me)"
    ),
}
UPDATE_B = {
    "organizations": "UPDATE organizations SET name = 'pwned' WHERE id = :b",
    "org_memberships": "UPDATE org_memberships SET role = 'member' WHERE org_id = :b",
}


@pytest.mark.parametrize("table", sorted(COUNT_B))
async def test_other_tenant_rows_are_invisible(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], table: str
) -> None:
    a, b = two_tenants
    own = COUNT_B[table].replace(":b", ":a")
    assert (
        await rows(rw_engine, COUNT_B[table], org_id=a.org_id, user_id=a.user_id, b=b.org_id) == []
    )
    assert await rows(rw_engine, own, org_id=a.org_id, user_id=a.user_id, a=a.org_id)


@pytest.mark.parametrize("table", sorted(INSERT_INTO_B))
async def test_inserts_into_other_tenant_are_rejected(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], table: str
) -> None:
    a, b = two_tenants
    before = await checksum()
    error = await denied(
        rw_engine,
        INSERT_INTO_B[table],
        org_id=a.org_id,
        user_id=a.user_id,
        b=b.org_id,
        me=a.user_id,
        b2=uuid.uuid4(),
        slug=f"probe-{uuid.uuid4().hex[:10]}",
    )
    assert "row-level security" in error
    assert await checksum() == before


@pytest.mark.parametrize("table", sorted(UPDATE_B))
async def test_other_tenant_rows_cannot_be_updated(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], table: str
) -> None:
    a, b = two_tenants
    before = await checksum()
    count = await affected(
        rw_engine, UPDATE_B[table], org_id=a.org_id, user_id=a.user_id, b=b.org_id
    )
    assert count == 0
    assert await checksum() == before


@pytest.mark.parametrize(
    "statement",
    [
        # Moving an own row into another tenant: blocked by column grants / WITH CHECK.
        "UPDATE org_memberships SET org_id = :b WHERE org_id = :a",
        "UPDATE organizations SET id = :b WHERE id = :a",
        "UPDATE issue_types SET org_id = :b WHERE org_id = :a",
        "UPDATE audit_events SET org_id = :b WHERE org_id = :a",
    ],
)
async def test_own_rows_cannot_be_moved_into_another_tenant(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], statement: str
) -> None:
    a, b = two_tenants
    error = await denied(
        rw_engine, statement, org_id=a.org_id, user_id=a.user_id, a=a.org_id, b=b.org_id
    )
    assert "permission denied" in error or "row-level security" in error


@pytest.mark.parametrize(
    "table",
    ["organizations", "org_memberships", "issue_types", "priorities", "audit_events", "outbox"],
)
async def test_runtime_role_cannot_delete_or_truncate_tenant_data(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant], table: str
) -> None:
    a, _ = two_tenants
    for statement in (f"DELETE FROM {table}", f"TRUNCATE {table}"):  # noqa: S608 - fixed list
        error = await denied(rw_engine, statement, org_id=a.org_id, user_id=a.user_id)
        assert "permission denied" in error


async def test_forged_org_binding_without_membership_sees_nothing(
    rw_engine: AsyncEngine, two_tenants: tuple[Tenant, Tenant]
) -> None:
    """Binding B's id while acting as A's user (a resolution bug) still reveals nothing."""
    a, b = two_tenants
    for table, sql in COUNT_B.items():
        assert await rows(rw_engine, sql, org_id=b.org_id, user_id=a.user_id, b=b.org_id) == [], (
            table
        )
    assert (
        await affected(
            rw_engine, UPDATE_B["organizations"], org_id=b.org_id, user_id=a.user_id, b=b.org_id
        )
        == 0
    )
