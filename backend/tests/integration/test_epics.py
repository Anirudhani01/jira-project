"""Epics panel data: epics with child progress (backlog Epics panel)."""

from typing import Any

import httpx

from tests.integration.test_issues import Ctx, new_issue, patch
from tests.integration.test_issues_hierarchy import transition, transitions_of, workflow_id_of
from tests.integration.test_projects import create_project, org_member

pytest_plugins = ["tests.integration.test_issues"]


def url(ctx: Ctx, project: str = "WEB", extra: str = "") -> str:
    return f"/api/v1/orgs/{ctx.slug}/projects/{project}/epics{extra}"


async def epic(ctx: Ctx, summary: str, project: str = "WEB") -> dict[str, Any]:
    body = ctx.body(summary, type_id=str(ctx.types["epic"]))
    response = await new_issue(ctx.http, ctx, body, project=project)
    assert response.status_code == 201, response.text
    return dict(response.json())


async def story(ctx: Ctx, summary: str, parent: dict[str, Any] | None = None) -> dict[str, Any]:
    extra = {"parent_id": parent["id"]} if parent else {}
    response = await new_issue(ctx.http, ctx, ctx.body(summary, **extra))
    assert response.status_code == 201, response.text
    return dict(response.json())


async def finish(ctx: Ctx, issue: dict[str, Any]) -> None:
    steps = await transitions_of(await workflow_id_of(ctx.tenant.org_id))
    done = await transition(
        ctx.http, ctx.slug, issue["key"], steps["Done"].id, f'"v{issue["version"]}"'
    )
    assert done.status_code == 200, done.text


async def items(http: httpx.AsyncClient, ctx: Ctx, **params: str) -> list[dict[str, Any]]:
    response = await http.get(url(ctx), params=params)
    assert response.status_code == 200, response.text
    return list(response.json()["items"])


async def test_epics_list_with_child_progress_in_rank_order(ctx: Ctx) -> None:
    first, second = await epic(ctx, "Checkout"), await epic(ctx, "Search")
    child_a = await story(ctx, "Pay", first)
    await story(ctx, "Refund", first)
    await story(ctx, "Unrelated, no epic")
    await finish(ctx, child_a)
    listed = await items(ctx.http, ctx)
    assert [(e["key"], e["done"], e["total"]) for e in listed] == [
        (first["key"], 1, 2),
        (second["key"], 0, 0),
    ]
    assert listed[0]["summary"] == "Checkout"
    assert listed[0]["status"]["category"] == "todo"


async def test_epics_in_a_done_status_are_hidden_unless_requested(ctx: Ctx) -> None:
    open_epic, closed_epic = await epic(ctx, "Open"), await epic(ctx, "Closed")
    await finish(ctx, closed_epic)
    assert [e["key"] for e in await items(ctx.http, ctx)] == [open_epic["key"]]
    both = await items(ctx.http, ctx, include_done="true")
    assert {e["key"] for e in both} == {open_epic["key"], closed_epic["key"]}


async def test_deleted_children_and_re_parenting_update_the_counts(ctx: Ctx) -> None:
    first, second = await epic(ctx, "One"), await epic(ctx, "Two")
    child = await story(ctx, "Moves between epics", first)
    assert [(e["key"], e["total"]) for e in await items(ctx.http, ctx)] == [
        (first["key"], 1),
        (second["key"], 0),
    ]
    moved = await patch(ctx.http, ctx.slug, child["key"], {"parent_id": second["id"]}, '"v1"')
    assert moved.status_code == 200, moved.text
    assert [(e["key"], e["total"]) for e in await items(ctx.http, ctx)] == [
        (first["key"], 0),
        (second["key"], 1),
    ]
    csrf = str((await ctx.http.get("/api/v1/auth/session")).json()["csrf_token"])
    deleted = await ctx.http.delete(
        f"/api/v1/orgs/{ctx.slug}/issues/{child['key']}",
        headers={"X-CSRF-Token": csrf, "If-Match": '"v2"'},
    )
    assert deleted.status_code == 204, deleted.text
    assert [(e["key"], e["total"]) for e in await items(ctx.http, ctx)] == [
        (first["key"], 0),
        (second["key"], 0),
    ]


async def test_only_epics_of_the_requested_project_are_returned(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    web = await epic(ctx, "Web epic")
    app = await epic(ctx, "App epic", project="APP")
    assert [e["key"] for e in await items(ctx.http, ctx)] == [web["key"]]
    other = await ctx.http.get(url(ctx, "APP"))
    assert [e["key"] for e in other.json()["items"]] == [app["key"]]


async def test_access_follows_project_visibility(ctx: Ctx) -> None:
    await epic(ctx, "Secret roadmap")
    outsider, _ = await org_member(ctx.stack, ctx.tenant)  # org member, no project role
    assert (await outsider.get(url(ctx))).status_code == 404
    assert (await ctx.http.get(url(ctx, "NOPE"))).status_code == 404
