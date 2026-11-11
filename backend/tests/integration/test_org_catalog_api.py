"""Organization catalog management API (Phase A)."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import pytest

from tests.integration import test_issues
from tests.integration.auth_support import auth_client, csrf, flush_test_redis, superuser_sql
from tests.integration.tenancy_support import Tenant, add_member, make_tenant, verified_user
from tests.integration.test_issues import Ctx, new_issue, patch

ctx = test_issues.ctx  # re-export the fixture so pytest finds it in this module

TYPES = "/api/v1/orgs/{slug}/issue-types"
TYPE = "/api/v1/orgs/{slug}/issue-types/{type_id}"
TYPE_ORDER = "/api/v1/orgs/{slug}/issue-types/order"
PRIORITIES = "/api/v1/orgs/{slug}/priorities"
PRIORITY = "/api/v1/orgs/{slug}/priorities/{priority_id}"


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


async def test_member_cannot_create_issue_type(tenant: Tenant) -> None:
    async with auth_client() as member_http:
        _, member_id = await verified_user(member_http)
        await add_member(tenant.org_id, member_id, "member")
        token = await csrf(member_http)
        response = await member_http.post(
            TYPES.format(slug=tenant.slug),
            json={"name": "Spike", "kind": "standard"},
            headers={"X-CSRF-Token": token},
        )
    assert response.status_code == 403


async def test_owner_crud_reorder_and_deactivate_issue_type(tenant: Tenant) -> None:
    headers = await tenant.headers()
    created = await tenant.http.post(
        TYPES.format(slug=tenant.slug),
        json={"name": "Spike", "kind": "standard"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "Spike"
    assert body["is_active"] is True
    type_id = body["id"]

    renamed = await tenant.http.patch(
        TYPE.format(slug=tenant.slug, type_id=type_id),
        json={"name": "Research"},
        headers=headers,
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Research"

    listed = (await tenant.http.get(TYPES.format(slug=tenant.slug))).json()["items"]
    ids = [row["id"] for row in listed]
    reordered = ids[-1:] + ids[:-1]
    order = await tenant.http.put(
        TYPE_ORDER.format(slug=tenant.slug),
        json={"ids": reordered},
        headers=headers,
    )
    assert order.status_code == 200
    assert order.json()["items"][0]["id"] == type_id

    deactivated = await tenant.http.patch(
        TYPE.format(slug=tenant.slug, type_id=type_id),
        json={"is_active": False},
        headers=headers,
    )
    assert deactivated.status_code == 200
    assert deactivated.json()["is_active"] is False


async def test_owner_priority_create_rename_deactivate(tenant: Tenant) -> None:
    headers = await tenant.headers()
    created = await tenant.http.post(
        PRIORITIES.format(slug=tenant.slug),
        json={"name": "Blocker", "color": "#111111"},
        headers=headers,
    )
    assert created.status_code == 201
    priority_id = created.json()["id"]
    patched = await tenant.http.patch(
        PRIORITY.format(slug=tenant.slug, priority_id=priority_id),
        json={"name": "Critical", "is_active": False},
        headers=headers,
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["name"] == "Critical"
    assert body["is_active"] is False


async def test_other_org_cannot_patch_catalog() -> None:
    async with AsyncExitStack() as stack:
        first = await make_tenant(stack)
        second = await make_tenant(stack)
        listed = (await first.http.get(TYPES.format(slug=first.slug))).json()["items"]
        type_id = listed[0]["id"]
        response = await second.http.patch(
            TYPE.format(slug=first.slug, type_id=type_id),
            json={"name": "Hijacked"},
            headers=await second.headers(),
        )
    assert response.status_code == 404


async def test_inactive_type_blocked_for_new_issues_but_visible_on_existing(ctx: Ctx) -> None:
    task_id = ctx.types["standard"]
    headers = await ctx.tenant.headers()
    ok = await new_issue(ctx.http, ctx, ctx.body())
    assert ok.status_code == 201
    key = ok.json()["key"]

    deactivated = await ctx.tenant.http.patch(
        TYPE.format(slug=ctx.slug, type_id=str(task_id)),
        json={"is_active": False},
        headers=headers,
    )
    assert deactivated.status_code == 200

    blocked = await new_issue(
        ctx.http,
        ctx,
        {**ctx.body(), "type_id": str(task_id)},
    )
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "inactive_type"

    issue = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{key}")).json()
    assert issue["type"]["id"] == str(task_id)


async def audit_actions(org_id: object) -> list[tuple[str, str]]:
    rows = await superuser_sql(
        "SELECT action, metadata::text AS md FROM audit_events WHERE org_id = :o ORDER BY id",
        o=org_id,
    )
    return [(r.action, r.md) for r in rows]


async def test_inactive_priority_rejected_on_issue_patch(ctx: Ctx) -> None:
    medium_id = ctx.priorities["Medium"]
    headers = await ctx.tenant.headers()
    created = await new_issue(
        ctx.http,
        ctx,
        ctx.body(priority_id=str(ctx.priorities["High"])),
    )
    assert created.status_code == 201
    key = created.json()["key"]
    issue = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{key}")).json()

    deactivated = await ctx.tenant.http.patch(
        PRIORITY.format(slug=ctx.slug, priority_id=str(medium_id)),
        json={"is_active": False},
        headers=headers,
    )
    assert deactivated.status_code == 200

    response = await patch(
        ctx.http,
        ctx.slug,
        key,
        {"priority_id": str(medium_id)},
        f'"v{issue["version"]}"',
    )
    assert response.status_code == 422
    assert response.json()["code"] == "inactive_priority"


async def test_priority_deactivate_and_reactivate_audit(ctx: Ctx) -> None:
    low_id = ctx.priorities["Low"]
    headers = await ctx.tenant.headers()
    before = await audit_actions(ctx.tenant.org_id)

    deactivated = await ctx.tenant.http.patch(
        PRIORITY.format(slug=ctx.slug, priority_id=str(low_id)),
        json={"is_active": False},
        headers=headers,
    )
    assert deactivated.status_code == 200
    after_deactivate = await audit_actions(ctx.tenant.org_id)
    assert after_deactivate[len(before) :] == [
        ("org.priority.updated", '{"fields": "is_active"}'),
    ]

    reactivated = await ctx.tenant.http.patch(
        PRIORITY.format(slug=ctx.slug, priority_id=str(low_id)),
        json={"is_active": True},
        headers=headers,
    )
    assert reactivated.status_code == 200
    after_reactivate = await audit_actions(ctx.tenant.org_id)
    assert after_reactivate[-1] == ("org.priority.updated", '{"fields": "is_active"}')
