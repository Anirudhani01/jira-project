"""Project Summary counts: issues per status, type and priority, and the unassigned count."""

from typing import Any

import httpx

from tests.integration.auth_support import auth_client
from tests.integration.tenancy_support import make_tenant
from tests.integration.test_board import move as board_move
from tests.integration.test_issues import (
    Ctx,
    fingerprint,
    new_issue,
    patch,
    project_role,
)
from tests.integration.test_key_aliases import rename
from tests.integration.test_projects import create_project, org_member, send
from tests.integration.test_sprints import issue, move, scrum, sprint

pytest_plugins = ["tests.integration.test_issues"]


def path(ctx: Ctx, key: str = "WEB", tail: str = "summary") -> str:
    return f"/api/v1/orgs/{ctx.slug}/projects/{key}/{tail}"


async def summary(http: httpx.AsyncClient, ctx: Ctx, key: str = "WEB") -> dict[str, Any]:
    response = await http.get(path(ctx, key))
    assert response.status_code == 200, response.text
    body: dict[str, Any] = response.json()
    return body


def counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    return {row["name"]: row["count"] for row in rows}


async def workflow_names(ctx: Ctx, key: str = "WEB") -> list[str]:
    response = await ctx.http.get(path(ctx, key, "workflow"))
    assert response.status_code == 200, response.text
    statuses = sorted(response.json()["statuses"], key=lambda s: s["position"])
    return [status["name"] for status in statuses]


async def column_status(ctx: Ctx, column: str, key: str = "WEB") -> str:
    board = (await ctx.http.get(path(ctx, key, "board"))).json()
    return str(next(c for c in board["columns"] if c["name"] == column)["status_ids"][0])


async def listed(ctx: Ctx, query: str) -> int:
    response = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues?project=WEB&limit=100&{query}")
    assert response.status_code == 200, response.text
    return len(response.json()["items"])


async def test_an_empty_project_lists_every_status_type_and_priority_with_zero(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="NEW")).status_code == 201
    body = await summary(ctx.http, ctx, "NEW")
    assert body["total"] == 0
    assert body["unassigned"] == 0
    # Every status of the workflow, in workflow order, even with no issues.
    assert [s["name"] for s in body["by_status"]] == await workflow_names(ctx, "NEW")
    assert {s["count"] for s in body["by_status"]} == {0}
    assert {s["category"] for s in body["by_status"]} <= {"todo", "in_progress", "done"}
    assert body["by_type"]
    assert {t["count"] for t in body["by_type"]} == {0}
    assert body["by_priority"]
    assert {p["count"] for p in body["by_priority"]} == {0}


async def test_counts_per_status_type_priority_and_unassigned(ctx: Ctx) -> None:
    first = (await new_issue(ctx.http, ctx, ctx.body("A"))).json()
    second = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body("B", type_id=str(ctx.types["epic"]), priority_id=str(ctx.priorities["High"])),
        )
    ).json()
    third = (await new_issue(ctx.http, ctx, ctx.body("C"))).json()
    done = await board_move(
        ctx.http, ctx, first["key"], {"to_status_id": await column_status(ctx, "Done")}, '"v1"'
    )
    assert done.status_code == 200, done.text
    progress = await board_move(
        ctx.http,
        ctx,
        second["key"],
        {"to_status_id": await column_status(ctx, "In Progress")},
        '"v1"',
    )
    assert progress.status_code == 200, progress.text
    owned = await patch(
        ctx.http, ctx.slug, third["key"], {"assignee_id": str(ctx.tenant.user_id)}, '"v1"'
    )
    assert owned.status_code == 200, owned.text

    body = await summary(ctx.http, ctx)
    statuses = counts(body["by_status"])
    assert statuses["To Do"] == 1
    assert statuses["In Progress"] == 1
    assert statuses["Done"] == 1
    assert sum(statuses.values()) == body["total"] == 3
    assert [s["name"] for s in body["by_status"]] == await workflow_names(ctx)
    assert counts(body["by_type"])["Epic"] == 1
    assert counts(body["by_type"])["Task"] == 2
    assert counts(body["by_priority"])["High"] == 1
    assert counts(body["by_priority"])["Medium"] == 2
    assert body["unassigned"] == 2  # A and B; C is assigned


async def test_deleted_issues_and_other_projects_are_not_counted(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    kept = (await new_issue(ctx.http, ctx, ctx.body("Kept"))).json()
    gone = (await new_issue(ctx.http, ctx, ctx.body("Gone"))).json()
    await new_issue(ctx.http, ctx, ctx.body("Elsewhere"), project="APP")
    assert kept["key"] == "WEB-1"
    assert (
        await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/issues/{gone['key']}")
    ).status_code == 204

    assert (await summary(ctx.http, ctx))["total"] == 1
    assert (await summary(ctx.http, ctx, "APP"))["total"] == 1


async def test_backlog_and_sprint_issues_are_all_counted(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    in_sprint, in_backlog = await issue(ctx, "Planned"), await issue(ctx, "Backlog")
    assert in_backlog["key"]
    await move(ctx, in_sprint["key"], {"sprint_id": planned["id"]}, in_sprint["version"])

    # Unlike the dashboard progress (active sprint only), the summary counts the whole project.
    assert (await summary(ctx.http, ctx, "SCR"))["total"] == 2


async def test_inactive_types_and_priorities_show_only_while_issues_use_them(ctx: Ctx) -> None:
    created = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body(
                "Urgent", type_id=str(ctx.types["epic"]), priority_id=str(ctx.priorities["High"])
            ),
        )
    ).json()
    types = f"/api/v1/orgs/{ctx.slug}/issue-types/{ctx.types['epic']}"
    priorities = f"/api/v1/orgs/{ctx.slug}/priorities/{ctx.priorities['High']}"
    assert (await send(ctx.http, "PATCH", types, {"is_active": False})).status_code == 200
    assert (await send(ctx.http, "PATCH", priorities, {"is_active": False})).status_code == 200

    body = await summary(ctx.http, ctx)
    epic = next(t for t in body["by_type"] if t["name"] == "Epic")
    high = next(p for p in body["by_priority"] if p["name"] == "High")
    assert (epic["active"], epic["count"]) == (False, 1)
    assert (high["active"], high["count"]) == (False, 1)

    changed = await patch(
        ctx.http,
        ctx.slug,
        created["key"],
        {"type_id": str(ctx.types["standard"]), "priority_id": str(ctx.priorities["Medium"])},
        '"v1"',
    )
    assert changed.status_code == 200, changed.text
    after = await summary(ctx.http, ctx)
    assert "Epic" not in counts(after["by_type"])
    assert "High" not in counts(after["by_priority"])


async def test_the_numbers_match_what_the_issue_list_shows_for_each_link(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx, ctx.body("A"))
    epic = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body("B", type_id=str(ctx.types["epic"]), priority_id=str(ctx.priorities["High"])),
        )
    ).json()
    mine = (await new_issue(ctx.http, ctx, ctx.body("C"))).json()
    await new_issue(ctx.http, ctx, ctx.body("D"))
    await patch(ctx.http, ctx.slug, mine["key"], {"assignee_id": str(ctx.tenant.user_id)}, '"v1"')
    done = await board_move(
        ctx.http, ctx, epic["key"], {"to_status_id": await column_status(ctx, "Done")}, '"v1"'
    )
    assert done.status_code == 200, done.text

    body = await summary(ctx.http, ctx)
    assert await listed(ctx, "") == body["total"]
    for category in ("todo", "in_progress", "done"):
        expected = sum(s["count"] for s in body["by_status"] if s["category"] == category)
        assert await listed(ctx, f"status_category={category}") == expected, category
    for row in body["by_type"]:
        assert await listed(ctx, f"type={row['type_id']}") == row["count"], row["name"]
    for row in body["by_priority"]:
        assert await listed(ctx, f"priority={row['priority_id']}") == row["count"], row["name"]
    assert await listed(ctx, "assignee=none") == body["unassigned"]


async def test_the_old_project_key_still_works(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx, ctx.body("Before the rename"))
    assert (await rename(ctx.http, ctx.slug, "WB2")).status_code == 200
    assert (await summary(ctx.http, ctx, "WEB"))["total"] == 1
    assert (await summary(ctx.http, ctx, "WB2"))["total"] == 1


async def test_who_can_read_the_summary(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx)
    viewer, _ = await project_role(ctx, "viewer")
    assert (await summary(viewer, ctx))["total"] == 1

    # Not a project member, a member of another organization, and an unknown project all look
    # the same: not found. No session at all is rejected before that.
    outsider, _ = await org_member(ctx.stack, ctx.tenant)
    unknown = await ctx.http.get(path(ctx, "NOPE"))
    assert unknown.status_code == 404
    other = await make_tenant(ctx.stack, "other")
    for response in (await outsider.get(path(ctx)), await other.http.get(path(ctx))):
        assert fingerprint(response)[0] == 404
    async with auth_client() as anonymous:
        assert (await anonymous.get(path(ctx))).status_code == 401
