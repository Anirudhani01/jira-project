"""Bulk change: one action over many issues, each applied through the single-issue path."""

import uuid
from typing import Any

import httpx

from tests.integration.auth_support import superuser_sql
from tests.integration.tenancy_support import make_tenant
from tests.integration.test_issues import Ctx, new_issue, project_role
from tests.integration.test_projects import create_project, send
from tests.integration.test_sprints import scrum, sprint, start

pytest_plugins = ["tests.integration.test_issues"]


async def make(
    ctx: Ctx, count: int = 3, project: str = "WEB", **extra: Any
) -> list[dict[str, Any]]:
    out = []
    for number in range(count):
        response = await new_issue(
            ctx.http, ctx, ctx.body(f"Item {number}", **extra), project=project
        )
        assert response.status_code == 201, response.text
        out.append(dict(response.json()))
    return out


async def bulk(
    ctx: Ctx, keys: list[str], action: str, http: httpx.AsyncClient | None = None, **fields: Any
) -> httpx.Response:
    return await send(
        http or ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/issues/bulk",
        {"keys": keys, "action": action, **fields},
    )


def outcome(response: httpx.Response) -> dict[str, tuple[bool, str | None]]:
    assert response.status_code == 200, response.text
    return {r["key"]: (r["ok"], r["code"]) for r in response.json()["results"]}


async def row(ctx: Ctx, key: str) -> Any:
    seq = int(key.split("-")[1])
    [found] = await superuser_sql(
        "SELECT i.* FROM issues i JOIN projects p ON p.id = i.project_id "
        "WHERE i.org_id = :o AND p.key = :k AND i.seq = :s",
        o=ctx.tenant.org_id,
        k=key.split("-", maxsplit=1)[0],
        s=seq,
    )
    return found


# ------------------------------------------------------------------------- success
async def test_assign_priority_and_parent_apply_to_every_issue(ctx: Ctx) -> None:
    items = await make(ctx)
    keys = [i["key"] for i in items]
    _, member_id = await project_role(ctx, "member")
    assigned = await bulk(ctx, keys, "assign", assignee_id=str(member_id))
    assert outcome(assigned) == dict.fromkeys(keys, (True, None))
    assert assigned.json()["succeeded"] == 3
    assert {str((await row(ctx, k)).assignee_id) for k in keys} == {str(member_id)}
    assert (await row(ctx, keys[0])).version == items[0]["version"] + 1
    unassigned = await bulk(ctx, keys, "assign", assignee_id=None)
    assert unassigned.json()["failed"] == 0
    assert {(await row(ctx, k)).assignee_id for k in keys} == {None}

    high = next(p for name, p in ctx.priorities.items() if name == "High")
    assert (await bulk(ctx, keys, "set_priority", priority_id=str(high))).json()["succeeded"] == 3

    epic = (await new_issue(ctx.http, ctx, ctx.body("Epic", type_id=str(ctx.types["epic"])))).json()
    parented = await bulk(ctx, keys, "set_parent", parent_id=epic["id"])
    assert parented.json()["succeeded"] == 3
    assert {str((await row(ctx, k)).parent_id) for k in keys} == {epic["id"]}
    activity = await superuser_sql(
        "SELECT count(*) AS n FROM issue_activity WHERE org_id = :o AND field = 'parent'",
        o=ctx.tenant.org_id,
    )
    assert activity[0].n == 3


async def test_move_to_a_sprint_and_back_and_delete(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    items = [
        dict((await new_issue(ctx.http, ctx, ctx.body(f"S{n}"), project="SCR")).json())
        for n in range(3)
    ]
    keys = [i["key"] for i in items]
    moved = await bulk(ctx, keys, "move_sprint", sprint_id=planned["id"])
    assert moved.json()["succeeded"] == 3
    assert {str((await row(ctx, k)).sprint_id) for k in keys} == {planned["id"]}
    backlog = await bulk(ctx, keys[:2], "move_sprint", sprint_id=None)
    assert backlog.json()["succeeded"] == 2
    deleted = await bulk(ctx, keys, "delete")
    assert deleted.json()["succeeded"] == 3
    assert {(await row(ctx, k)).deleted_at is not None for k in keys} == {True}
    await start(ctx, planned["id"])  # still a valid, now empty, sprint


async def test_set_and_clear_the_fix_version(ctx: Ctx) -> None:
    items = await make(ctx, 2)
    keys = [i["key"] for i in items]
    created = await send(
        ctx.http, "POST", f"/api/v1/orgs/{ctx.slug}/projects/WEB/versions", {"name": "1.0"}
    )
    version_id = created.json()["id"]
    assert (await bulk(ctx, keys, "set_fix_version", fix_version_id=version_id)).json()[
        "succeeded"
    ] == 2
    assert {str((await row(ctx, k)).fix_version_id) for k in keys} == {version_id}
    assert (await bulk(ctx, keys, "set_fix_version", fix_version_id=None)).json()["succeeded"] == 2
    await send(ctx.http, "POST", f"/api/v1/orgs/{ctx.slug}/versions/{version_id}/archive")
    rejected = await bulk(ctx, keys, "set_fix_version", fix_version_id=version_id)
    assert outcome(rejected) == dict.fromkeys(keys, (False, "version_archived"))


# ---------------------------------------------------------------- partial failures
async def test_each_item_is_checked_on_its_own_and_failures_do_not_block_others(ctx: Ctx) -> None:
    good = await make(ctx, 2)
    keys = [good[0]["key"], "WEB-999", good[1]["key"], "NOPE-1"]
    result = await bulk(ctx, keys, "set_priority", priority_id=str(ctx.priorities["Low"]))
    assert result.status_code == 200
    assert outcome(result) == {
        keys[0]: (True, None),
        "WEB-999": (False, "not_found"),
        keys[2]: (True, None),
        "NOPE-1": (False, "not_found"),
    }
    assert (result.json()["succeeded"], result.json()["failed"]) == (2, 2)


async def test_hierarchy_rules_apply_per_item(ctx: Ctx) -> None:
    epic = (await new_issue(ctx.http, ctx, ctx.body("E", type_id=str(ctx.types["epic"])))).json()
    story = (await new_issue(ctx.http, ctx, ctx.body("Story"))).json()
    other_epic = (
        await new_issue(ctx.http, ctx, ctx.body("E2", type_id=str(ctx.types["epic"])))
    ).json()
    result = await bulk(ctx, [story["key"], other_epic["key"]], "set_parent", parent_id=epic["id"])
    results = outcome(result)
    assert results[story["key"]] == (True, None)
    assert results[other_epic["key"]][0] is False  # an epic cannot have a parent


async def test_permissions_are_enforced_for_every_item(ctx: Ctx) -> None:
    items = await make(ctx, 2)
    keys = [i["key"] for i in items]
    viewer, _ = await project_role(ctx, "viewer")
    member, _ = await project_role(ctx, "member")
    denied = await bulk(
        ctx, keys, "set_priority", http=viewer, priority_id=str(ctx.priorities["Low"])
    )
    assert outcome(denied) == dict.fromkeys(keys, (False, "forbidden"))
    no_delete = await bulk(ctx, keys, "delete", http=member)
    assert outcome(no_delete) == dict.fromkeys(keys, (False, "forbidden"))
    assert {(await row(ctx, k)).deleted_at for k in keys} == {None}


async def test_keys_of_another_organization_are_just_not_found(ctx: Ctx) -> None:
    items = await make(ctx, 1)
    other = await make_tenant(ctx.stack, "other")
    assert (await create_project(other.http, other.slug)).status_code == 201
    result = await send(
        other.http,
        "POST",
        f"/api/v1/orgs/{other.slug}/issues/bulk",
        {"keys": [items[0]["key"]], "action": "delete"},
    )
    assert outcome(result) == {items[0]["key"]: (False, "not_found")}
    assert (await row(ctx, items[0]["key"])).deleted_at is None


# ---------------------------------------------------------------------- validation
async def test_request_shape_is_validated(ctx: Ctx) -> None:
    key = (await make(ctx, 1))[0]["key"]
    priority = str(ctx.priorities["Low"])
    cases: list[dict[str, Any]] = [
        {"keys": [], "action": "delete"},
        {"keys": [key, key], "action": "delete"},
        {"keys": [f"WEB-{n}" for n in range(1, 102)], "action": "delete"},
        {"keys": ["not a key"], "action": "delete"},
        {"keys": [key], "action": "explode"},
        {"keys": [key], "action": "assign"},  # missing assignee_id
        {"keys": [key], "action": "delete", "assignee_id": str(uuid.uuid4())},
        {"keys": [key], "action": "assign", "priority_id": priority},  # wrong field
        {"keys": [key], "action": "set_priority", "priority_id": None},
        {"keys": [key], "action": "delete", "unknown": 1},
    ]
    for body in cases:
        response = await send(ctx.http, "POST", f"/api/v1/orgs/{ctx.slug}/issues/bulk", body)
        assert response.status_code == 422, body


async def test_one_audit_event_records_the_call_with_counts(ctx: Ctx) -> None:
    keys = [i["key"] for i in await make(ctx, 2)]
    await bulk(ctx, [*keys, "WEB-404"], "set_priority", priority_id=str(ctx.priorities["Low"]))
    [event] = await superuser_sql(
        "SELECT metadata FROM audit_events WHERE org_id = :o AND action = 'issue.bulk'",
        o=ctx.tenant.org_id,
    )
    assert event.metadata == {"action": "set_priority", "requested": 3, "succeeded": 2}


async def test_unauthenticated_and_csrf_are_enforced(ctx: Ctx) -> None:
    url = f"/api/v1/orgs/{ctx.slug}/issues/bulk"
    no_csrf = await ctx.http.post(url, json={"keys": ["WEB-1"], "action": "delete"})
    assert no_csrf.status_code == 403
