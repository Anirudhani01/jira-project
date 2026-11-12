"""Project list issue and done counts for the org dashboard (ProjectListItem)."""

from typing import Any

from tests.integration.test_board import move as board_move
from tests.integration.test_issues import Ctx, new_issue
from tests.integration.test_projects import create_project, org_member, send
from tests.integration.test_sprints import (
    issue,
    move,
    scrum,
    sprint,
    start,
    status_ids,
)

pytest_plugins = ["tests.integration.test_issues"]


async def listed(http: Any, ctx: Ctx) -> dict[str, dict[str, Any]]:
    response = await http.get(f"/api/v1/orgs/{ctx.slug}/projects")
    assert response.status_code == 200, response.text
    return {item["key"]: item for item in response.json()["items"]}


def totals(item: dict[str, Any]) -> tuple[int, int, str | None]:
    return item["issue_count"], item["done_count"], item["active_sprint"]


async def test_kanban_counts_every_issue_and_the_done_ones_but_not_deleted(ctx: Ctx) -> None:
    created = await create_project(ctx.http, ctx.slug, key="KAN", board_type="kanban")
    assert created.status_code == 201, created.text
    assert totals((await listed(ctx.http, ctx))["KAN"]) == (0, 0, None)

    cards = [
        (await new_issue(ctx.http, ctx, ctx.body(f"Card {n}"), project="KAN")).json()
        for n in range(3)
    ]
    board = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/projects/KAN/board")).json()
    done = next(c for c in board["columns"] if c["name"] == "Done")["status_ids"][0]
    moved = await board_move(ctx.http, ctx, cards[0]["key"], {"to_status_id": done}, '"v1"')
    assert moved.status_code == 200, moved.text
    assert totals((await listed(ctx.http, ctx))["KAN"]) == (3, 1, None)

    path = f"/api/v1/orgs/{ctx.slug}/issues/{cards[1]['key']}"
    assert (await send(ctx.http, "DELETE", path)).status_code == 204
    assert totals((await listed(ctx.http, ctx))["KAN"]) == (2, 1, None)


async def test_scrum_counts_only_the_active_sprint(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    in_sprint, outside = await issue(ctx, "In"), await issue(ctx, "Out")
    assert outside["key"]
    assert totals((await listed(ctx.http, ctx))["SCR"]) == (0, 0, None)

    await move(ctx, in_sprint["key"], {"sprint_id": planned["id"]}, in_sprint["version"])
    assert totals((await listed(ctx.http, ctx))["SCR"]) == (0, 0, None)  # planned, not started

    assert (await start(ctx, planned["id"])).status_code == 200
    assert totals((await listed(ctx.http, ctx))["SCR"]) == (1, 0, "Sprint 1")

    statuses = await status_ids(ctx)
    current = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{in_sprint['key']}")).json()
    finished = await move(
        ctx, in_sprint["key"], {"to_status_id": statuses["Done"]}, current["version"]
    )
    assert finished.status_code == 200, finished.text
    assert totals((await listed(ctx.http, ctx))["SCR"]) == (1, 1, "Sprint 1")


async def test_a_plain_member_gets_counts_only_for_projects_they_belong_to(ctx: Ctx) -> None:
    assert (
        await create_project(ctx.http, ctx.slug, key="KAN", board_type="kanban")
    ).status_code == 201
    await new_issue(ctx.http, ctx, ctx.body("Hidden"), project="KAN")
    member, _ = await org_member(ctx.stack, ctx.tenant)
    assert await listed(member, ctx) == {}
    assert totals((await listed(ctx.http, ctx))["KAN"]) == (1, 0, None)
