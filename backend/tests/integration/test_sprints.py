"""M10: sprints, backlog, sprint moves and completion carry-over (plan M10, R4, R7-M10)."""

import asyncio
import uuid
from typing import Any

import httpx

from tests.integration.auth_support import superuser_sql
from tests.integration.test_issues import Ctx, issue_row, new_issue
from tests.integration.test_projects import create_project, org_member, send

pytest_plugins = ["tests.integration.test_issues"]

START = {"start_at": "2026-11-02T09:00:00Z", "end_at": "2026-11-16T17:00:00Z"}


def base(ctx: Ctx, key: str = "SCR") -> str:
    return f"/api/v1/orgs/{ctx.slug}/projects/{key}"


async def scrum(ctx: Ctx) -> None:
    response = await create_project(ctx.http, ctx.slug, key="SCR", board_type="scrum")
    assert response.status_code == 201, response.text


async def sprint(
    ctx: Ctx, name: str = "Sprint 1", http: httpx.AsyncClient | None = None
) -> dict[str, Any]:
    response = await send(http or ctx.http, "POST", f"{base(ctx)}/sprints", {"name": name})
    assert response.status_code == 201, response.text
    return dict(response.json())


async def issue(ctx: Ctx, summary: str = "Task") -> dict[str, Any]:
    response = await new_issue(ctx.http, ctx, ctx.body(summary), project="SCR")
    assert response.status_code == 201, response.text
    return dict(response.json())


async def move(
    ctx: Ctx,
    key: str,
    body: dict[str, Any],
    version: int | None = None,
    http: httpx.AsyncClient | None = None,
) -> httpx.Response:
    client = http or ctx.http
    headers = {"X-CSRF-Token": str((await client.get("/api/v1/auth/session")).json()["csrf_token"])}
    if version is not None:
        headers["If-Match"] = f'"v{version}"'
    return await client.post(
        f"/api/v1/orgs/{ctx.slug}/issues/{key}/move", json=body, headers=headers
    )


async def start(ctx: Ctx, sprint_id: str) -> httpx.Response:
    return await send(ctx.http, "POST", f"/api/v1/orgs/{ctx.slug}/sprints/{sprint_id}/start", START)


async def complete(ctx: Ctx, sprint_id: str, target: str = "backlog") -> httpx.Response:
    return await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/sprints/{sprint_id}/complete",
        {"move_open_issues_to": target},
    )


async def status_ids(ctx: Ctx) -> dict[str, str]:
    board = (await ctx.http.get(f"{base(ctx)}/board")).json()
    return {c["name"]: c["status_ids"][0] for c in board["columns"]}


async def sprint_of(ctx: Ctx, issue_key: str) -> Any:
    row = await issue_row(ctx.tenant.org_id, int(issue_key.split("-")[1]), "SCR")
    return row.sprint_id


# ------------------------------------------------------------------------- lifecycle
async def test_only_scrum_projects_have_sprints(ctx: Ctx) -> None:
    response = await send(ctx.http, "POST", f"{base(ctx, 'WEB')}/sprints", {"name": "S"})
    assert response.status_code == 422
    assert response.json()["code"] == "sprints_require_scrum_project"


async def test_create_list_edit_and_delete_a_future_sprint(ctx: Ctx) -> None:
    await scrum(ctx)
    created = await sprint(ctx)
    assert created["state"] == "future"
    assert created["issue_count"] == 0
    renamed = await send(
        ctx.http,
        "PATCH",
        f"/api/v1/orgs/{ctx.slug}/sprints/{created['id']}",
        {"name": "Alpha", "goal": "Ship"},
    )
    assert renamed.status_code == 200
    assert (renamed.json()["name"], renamed.json()["goal"]) == ("Alpha", "Ship")
    listed = (await ctx.http.get(f"{base(ctx)}/sprints")).json()["items"]
    assert [s["name"] for s in listed] == ["Alpha"]
    bad = await send(
        ctx.http, "PATCH", f"/api/v1/orgs/{ctx.slug}/sprints/{created['id']}", {"state": "closed"}
    )
    assert bad.status_code == 422
    gone = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/sprints/{created['id']}")
    assert gone.status_code == 204
    assert (await ctx.http.get(f"{base(ctx)}/sprints")).json()["items"] == []


async def test_start_validates_dates_and_allows_one_active_sprint(ctx: Ctx) -> None:
    await scrum(ctx)
    first, second = await sprint(ctx, "One"), await sprint(ctx, "Two")
    url = f"/api/v1/orgs/{ctx.slug}/sprints/{first['id']}/start"
    inverted = await send(
        ctx.http, "POST", url, {"start_at": START["end_at"], "end_at": START["start_at"]}
    )
    assert inverted.status_code == 422
    naive = await send(
        ctx.http, "POST", url, {"start_at": "2026-11-02T09:00:00", "end_at": START["end_at"]}
    )
    assert naive.status_code == 422
    started = await start(ctx, first["id"])
    assert started.status_code == 200, started.text
    assert started.json()["state"] == "active"
    again = await start(ctx, second["id"])
    assert again.status_code == 409
    assert again.json()["code"] == "sprint_already_active"
    restart = await start(ctx, first["id"])
    assert restart.json()["code"] == "sprint_not_future"
    active_delete = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/sprints/{first['id']}")
    assert active_delete.status_code == 409
    assert active_delete.json()["code"] == "sprint_not_deletable"


async def test_concurrent_starts_in_one_project_produce_one_conflict(ctx: Ctx) -> None:
    await scrum(ctx)
    first, second = await sprint(ctx, "One"), await sprint(ctx, "Two")
    results = await asyncio.gather(start(ctx, first["id"]), start(ctx, second["id"]))
    assert sorted(r.status_code for r in results) == [200, 409]
    [active] = await superuser_sql(
        "SELECT count(*) AS n FROM sprints WHERE org_id = :o AND state = 'active'",
        o=ctx.tenant.org_id,
    )
    assert active.n == 1


# ---------------------------------------------------------------- moves and backlog
async def test_issue_moves_into_a_sprint_and_back_with_activity(ctx: Ctx) -> None:
    await scrum(ctx)
    planned, task = await sprint(ctx), await issue(ctx)
    assert task["sprint"] is None
    missing = await move(ctx, task["key"], {"sprint_id": planned["id"]})
    assert missing.status_code == 428
    moved = await move(ctx, task["key"], {"sprint_id": planned["id"]}, task["version"])
    assert moved.status_code == 200, moved.text
    assert moved.json()["sprint"] == {"id": planned["id"], "name": "Sprint 1", "state": "future"}
    assert moved.json()["version"] == task["version"] + 1
    back = await move(ctx, task["key"], {"sprint_id": None}, moved.json()["version"])
    assert back.status_code == 200
    assert back.json()["sprint"] is None
    actions = await superuser_sql(
        "SELECT action, new_value FROM issue_activity "
        "WHERE issue_id = :i AND action = 'sprint_changed' "
        "ORDER BY id",
        i=uuid.UUID(task["id"]),
    )
    assert len(actions) == 2
    unknown = await move(ctx, task["key"], {"sprint_id": str(uuid.uuid4())}, back.json()["version"])
    assert unknown.status_code == 422
    assert unknown.json()["code"] == "invalid_sprint"


async def test_backlog_lists_sprints_then_unfinished_unplanned_issues(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    first, second = await issue(ctx, "First"), await issue(ctx, "Second")
    await move(ctx, first["key"], {"sprint_id": planned["id"]}, first["version"])
    backlog = (await ctx.http.get(f"{base(ctx)}/backlog")).json()
    assert [s["sprint"]["name"] for s in backlog["sprints"]] == ["Sprint 1"]
    assert [i["key"] for i in backlog["sprints"][0]["issues"]] == [first["key"]]
    assert backlog["sprints"][0]["sprint"]["issue_count"] == 1
    assert [i["key"] for i in backlog["backlog"]] == [second["key"]]
    assert backlog["truncated"] is False


async def test_deleting_a_future_sprint_returns_issues_to_the_backlog(ctx: Ctx) -> None:
    await scrum(ctx)
    planned, task = await sprint(ctx), await issue(ctx)
    await move(ctx, task["key"], {"sprint_id": planned["id"]}, task["version"])
    assert (
        await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/sprints/{planned['id']}")
    ).status_code == 204
    assert await sprint_of(ctx, task["key"]) is None


async def test_scrum_board_shows_only_the_active_sprint(ctx: Ctx) -> None:
    await scrum(ctx)
    planned, in_sprint, outside = await sprint(ctx), await issue(ctx, "In"), await issue(ctx, "Out")
    await move(ctx, in_sprint["key"], {"sprint_id": planned["id"]}, in_sprint["version"])
    empty = (await ctx.http.get(f"{base(ctx)}/board")).json()
    assert empty["sprint"] is None
    assert sum(c["count"] for c in empty["columns"]) == 0
    assert (await start(ctx, planned["id"])).status_code == 200
    board = (await ctx.http.get(f"{base(ctx)}/board")).json()
    assert board["sprint"]["name"] == "Sprint 1"
    assert [c["key"] for col in board["columns"] for c in col["issues"]] == [in_sprint["key"]]
    assert outside["key"] not in str(board)


# ------------------------------------------------------------------------- completion
async def test_complete_carries_unfinished_issues_to_backlog_and_keeps_done_ones(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    open_issue, done_issue = await issue(ctx, "Open"), await issue(ctx, "Done")
    for item in (open_issue, done_issue):
        await move(ctx, item["key"], {"sprint_id": planned["id"]}, item["version"])
    await start(ctx, planned["id"])
    statuses = await status_ids(ctx)
    current = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{done_issue['key']}")).json()
    finished = await move(
        ctx, done_issue["key"], {"to_status_id": statuses["Done"]}, current["version"]
    )
    assert finished.status_code == 200, finished.text
    before = await issue_row(ctx.tenant.org_id, int(open_issue["key"].split("-")[1]), "SCR")
    result = await complete(ctx, planned["id"])
    assert result.status_code == 200, result.text
    assert result.json()["moved_issues"] == 1
    assert result.json()["sprint"]["state"] == "closed"
    after = await issue_row(ctx.tenant.org_id, int(open_issue["key"].split("-")[1]), "SCR")
    assert after.sprint_id is None
    assert after.version == before.version + 1
    assert str(await sprint_of(ctx, done_issue["key"])) == planned["id"]
    [event] = await superuser_sql(
        "SELECT metadata FROM audit_events WHERE org_id = :o AND action = 'sprint.completed'",
        o=ctx.tenant.org_id,
    )
    assert event.metadata["moved"] == 1
    carried = await superuser_sql(
        "SELECT old_value, new_value FROM issue_activity "
        "WHERE issue_id = :i AND action = 'sprint_changed' "
        "ORDER BY id DESC LIMIT 1",
        i=uuid.UUID(open_issue["id"]),
    )
    assert carried[0].new_value is None
    assert (await complete(ctx, planned["id"])).status_code == 409


async def test_complete_can_carry_over_to_a_future_sprint(ctx: Ctx) -> None:
    await scrum(ctx)
    current, nxt = await sprint(ctx, "Now"), await sprint(ctx, "Next")
    task = await issue(ctx)
    await move(ctx, task["key"], {"sprint_id": current["id"]}, task["version"])
    await start(ctx, current["id"])
    self_target = await complete(ctx, current["id"], current["id"])
    assert self_target.status_code == 422
    unknown = await complete(ctx, current["id"], str(uuid.uuid4()))
    assert unknown.status_code == 422
    assert unknown.json()["code"] == "invalid_target_sprint"
    assert (await complete(ctx, current["id"], nxt["id"])).status_code == 200
    assert str(await sprint_of(ctx, task["key"])) == nxt["id"]


async def test_closed_sprint_rejects_new_issues_and_edits(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    await start(ctx, planned["id"])
    await complete(ctx, planned["id"])
    task = await issue(ctx)
    rejected = await move(ctx, task["key"], {"sprint_id": planned["id"]}, task["version"])
    assert rejected.status_code == 409
    assert rejected.json()["code"] == "sprint_closed"
    edit = await send(
        ctx.http, "PATCH", f"/api/v1/orgs/{ctx.slug}/sprints/{planned['id']}", {"name": "X"}
    )
    assert edit.status_code == 409


async def test_add_during_completion_is_carried_over_or_rejected_never_stranded(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    tasks = [await issue(ctx, f"Racer {n}") for n in range(4)]
    await start(ctx, planned["id"])
    results = await asyncio.gather(
        complete(ctx, planned["id"]),
        *[move(ctx, t["key"], {"sprint_id": planned["id"]}, t["version"]) for t in tasks],
    )
    assert results[0].status_code == 200
    assert all(r.status_code in (200, 409) for r in results[1:])
    [stranded] = await superuser_sql(
        "SELECT count(*) AS n FROM issues WHERE org_id = :o AND sprint_id = :s",
        o=ctx.tenant.org_id,
        s=uuid.UUID(planned["id"]),
    )
    assert stranded.n == 0


# ------------------------------------------------------------------------------ access
async def test_viewers_read_but_cannot_manage_sprints_and_outsiders_see_404(ctx: Ctx) -> None:
    await scrum(ctx)
    planned = await sprint(ctx)
    viewer, viewer_id = await org_member(ctx.stack, ctx.tenant)
    await send(
        ctx.http, "POST", f"{base(ctx)}/members", {"user_id": str(viewer_id), "role": "viewer"}
    )
    assert (await viewer.get(f"{base(ctx)}/sprints")).status_code == 200
    assert (await viewer.get(f"{base(ctx)}/backlog")).status_code == 200
    assert (await send(viewer, "POST", f"{base(ctx)}/sprints", {"name": "Nope"})).status_code == 403
    for suffix, body in (("start", START), ("complete", {})):
        url = f"/api/v1/orgs/{ctx.slug}/sprints/{planned['id']}/{suffix}"
        assert (await send(viewer, "POST", url, body)).status_code == 403
    assert (
        await send(viewer, "DELETE", f"/api/v1/orgs/{ctx.slug}/sprints/{planned['id']}")
    ).status_code == 403
    outsider, _ = await org_member(ctx.stack, ctx.tenant)
    assert (await outsider.get(f"{base(ctx)}/sprints")).status_code == 404
    unseen = await send(outsider, "DELETE", f"/api/v1/orgs/{ctx.slug}/sprints/{planned['id']}")
    assert unseen.status_code == 404


async def test_project_members_can_plan_sprints(ctx: Ctx) -> None:
    await scrum(ctx)
    member, member_id = await org_member(ctx.stack, ctx.tenant)
    await send(
        ctx.http, "POST", f"{base(ctx)}/members", {"user_id": str(member_id), "role": "member"}
    )
    created = await sprint(ctx, "Planned by member", http=member)
    assert created["state"] == "future"
