"""UI PR 11: story points on issues and per-sprint point totals."""

import uuid
from typing import Any

import pytest
from sqlalchemy.exc import DBAPIError

from tests.integration.auth_support import superuser_sql
from tests.integration.test_issues import Ctx, new_issue, patch, project_role
from tests.integration.test_sprints import complete, issue, move, scrum, sprint, start, status_ids

pytest_plugins = ["tests.integration.test_issues"]


async def created(ctx: Ctx, points: object = None, **extra: object) -> dict[str, Any]:
    body = ctx.body("Estimated", **extra)
    if points is not None:
        body["story_points"] = points
    response = await new_issue(ctx.http, ctx, body)
    assert response.status_code == 201, response.text
    return dict(response.json())


async def test_points_default_to_none_and_accept_the_allowed_range(ctx: Ctx) -> None:
    assert (await created(ctx))["story_points"] is None
    assert (await created(ctx, 0))["story_points"] == 0
    assert (await created(ctx, 5))["story_points"] == 5
    assert (await created(ctx, 100))["story_points"] == 100


@pytest.mark.parametrize("bad", [-1, 101, 2.5, "five", True])
async def test_invalid_points_are_rejected_on_create_and_update(ctx: Ctx, bad: object) -> None:
    body = ctx.body("Bad", story_points=bad)
    assert (await new_issue(ctx.http, ctx, body)).status_code == 422
    base = await created(ctx)
    rejected = await patch(ctx.http, ctx.slug, base["key"], {"story_points": bad}, '"v1"')
    assert rejected.status_code == 422


async def test_changing_points_bumps_version_and_writes_activity(ctx: Ctx) -> None:
    base = await created(ctx, 3)
    changed = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 8}, '"v1"')
    assert changed.status_code == 200, changed.text
    assert changed.json()["story_points"] == 8
    assert changed.json()["version"] == 2
    [entry] = await superuser_sql(
        "SELECT old_value, new_value FROM issue_activity "
        "WHERE issue_id = :i AND field = 'story_points'",
        i=uuid.UUID(base["id"]),
    )
    assert (entry.old_value, entry.new_value) == (3, 8)


async def test_same_value_is_a_no_op_and_null_clears(ctx: Ctx) -> None:
    base = await created(ctx, 3)
    same = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 3}, '"v1"')
    assert same.status_code == 200
    assert same.json()["version"] == 1
    cleared = await patch(ctx.http, ctx.slug, base["key"], {"story_points": None}, '"v1"')
    assert cleared.json()["story_points"] is None
    assert cleared.json()["version"] == 2


async def test_stale_version_still_conflicts(ctx: Ctx) -> None:
    base = await created(ctx, 3)
    await patch(ctx.http, ctx.slug, base["key"], {"story_points": 5}, '"v1"')
    stale = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 8}, '"v1"')
    assert stale.status_code == 412


async def test_viewers_cannot_change_points(ctx: Ctx) -> None:
    base = await created(ctx, 3)
    viewer, _ = await project_role(ctx, "viewer")
    denied = await patch(viewer, ctx.slug, base["key"], {"story_points": 5}, '"v1"')
    assert denied.status_code == 403


async def test_the_database_enforces_the_range(ctx: Ctx) -> None:
    base = await created(ctx, 3)
    with pytest.raises(DBAPIError):
        await superuser_sql(
            "UPDATE issues SET story_points = 101 WHERE id = :i", i=uuid.UUID(base["id"])
        )


async def test_sprint_totals_count_all_points_and_the_finished_ones(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    first = await issue(ctx, "Five")
    second = await issue(ctx, "Eight")
    third = await issue(ctx, "No estimate")
    for item, points in ((first, 5), (second, 8)):
        edited = await patch(ctx.http, ctx.slug, item["key"], {"story_points": points}, '"v1"')
        assert edited.status_code == 200, edited.text
    for key in (first["key"], second["key"], third["key"]):
        current = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{key}")).json()
        moved = await move(ctx, key, {"sprint_id": planned["id"]}, current["version"])
        assert moved.status_code == 200, moved.text
    await start(ctx, planned["id"])
    sprints = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/projects/SCR/sprints")).json()["items"]
    assert (sprints[0]["issue_count"], sprints[0]["points_total"], sprints[0]["points_done"]) == (
        3,
        13,
        0,
    )
    done = (await status_ids(ctx))["Done"]
    current = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{first['key']}")).json()
    assert (
        await move(ctx, first["key"], {"to_status_id": done}, current["version"])
    ).status_code == 200
    sprints = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/projects/SCR/sprints")).json()["items"]
    assert (sprints[0]["points_total"], sprints[0]["points_done"]) == (13, 5)
    backlog = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/projects/SCR/backlog")).json()
    assert backlog["sprints"][0]["sprint"]["points_total"] == 13
    assert {i["story_points"] for i in backlog["sprints"][0]["issues"]} == {5, 8, None}
    assert (await complete(ctx, planned["id"])).json()["sprint"]["points_done"] == 5
