"""M9: board read, column configuration and atomic moves (plan M9, R4, R7-M9)."""

import uuid
from typing import Any

import httpx

from tests.integration.auth_support import superuser_sql
from tests.integration.test_issues import Ctx, issue_row, new_issue, project_role
from tests.integration.test_projects import org_member, send

pytest_plugins = ["tests.integration.test_issues"]


def board_url(ctx: Ctx) -> str:
    return f"/api/v1/orgs/{ctx.slug}/projects/WEB/board"


async def get_board(http: httpx.AsyncClient, ctx: Ctx) -> dict[str, Any]:
    response = await http.get(board_url(ctx))
    assert response.status_code == 200, response.text
    return dict(response.json())


async def csrf(http: httpx.AsyncClient) -> str:
    return str((await http.get("/api/v1/auth/session")).json()["csrf_token"])


async def move(
    http: httpx.AsyncClient,
    ctx: Ctx,
    key: str,
    body: dict[str, Any],
    if_match: str | None = None,
) -> httpx.Response:
    headers = {"X-CSRF-Token": await csrf(http)}
    if if_match is not None:
        headers["If-Match"] = if_match
    return await http.post(f"/api/v1/orgs/{ctx.slug}/issues/{key}/move", json=body, headers=headers)


def keys(board: dict[str, Any], column: int) -> list[str]:
    return [card["key"] for card in board["columns"][column]["issues"]]


async def make_issues(ctx: Ctx, count: int) -> list[dict[str, Any]]:
    created = []
    for number in range(count):
        response = await new_issue(ctx.http, ctx, ctx.body(f"Issue {number}"))
        assert response.status_code == 201, response.text
        created.append(response.json())
    return created


# ------------------------------------------------------------------------ board read
async def test_board_groups_cards_by_column_in_rank_order(ctx: Ctx) -> None:
    first, second, third = await make_issues(ctx, 3)
    board = await get_board(ctx.http, ctx)
    assert [c["name"] for c in board["columns"]] == ["To Do", "In Progress", "In Review", "Done"]
    assert board["board_type"] in ("kanban", "scrum")
    assert keys(board, 0) == [first["key"], second["key"], third["key"]]
    assert board["columns"][0]["count"] == 3
    assert board["truncated"] is False
    assert board["transitions"]


async def test_viewer_reads_but_cannot_move_or_configure(ctx: Ctx) -> None:
    [issue] = await make_issues(ctx, 1)
    viewer, _ = await project_role(ctx, "viewer")
    board = await get_board(viewer, ctx)
    target = board["columns"][1]["status_ids"][0]
    denied = await move(viewer, ctx, issue["key"], {"to_status_id": target}, '"v1"')
    assert denied.status_code == 403
    columns = [
        {"id": c["id"], "name": c["name"], "status_ids": c["status_ids"]} for c in board["columns"]
    ]
    put = await send(viewer, "PUT", f"{board_url(ctx)}/columns", {"columns": columns})
    assert put.status_code == 403


async def test_board_is_not_visible_to_non_project_members(ctx: Ctx) -> None:
    outsider, _ = await org_member(ctx.stack, ctx.tenant)
    assert (await outsider.get(board_url(ctx))).status_code == 404


async def test_board_query_count_does_not_grow_with_cards(ctx: Ctx) -> None:
    await make_issues(ctx, 1)
    small = await get_board(ctx.http, ctx)
    await make_issues(ctx, 6)
    large = await get_board(ctx.http, ctx)
    assert large["columns"][0]["count"] == small["columns"][0]["count"] + 6


# ----------------------------------------------------------------------------- moves
async def test_reorder_inside_column_does_not_bump_version(ctx: Ctx) -> None:
    first, second, third = await make_issues(ctx, 3)
    response = await move(ctx.http, ctx, third["key"], {"before_key": first["key"]})
    assert response.status_code == 200, response.text
    assert response.json()["version"] == third["version"]
    board = await get_board(ctx.http, ctx)
    assert keys(board, 0) == [third["key"], first["key"], second["key"]]
    between = await move(
        ctx.http, ctx, third["key"], {"after_key": first["key"], "before_key": second["key"]}
    )
    assert between.status_code == 200
    assert keys(await get_board(ctx.http, ctx), 0) == [first["key"], third["key"], second["key"]]


async def test_move_to_other_column_is_atomic_and_logged(ctx: Ctx) -> None:
    first, second = (await make_issues(ctx, 2))[:2]
    board = await get_board(ctx.http, ctx)
    in_progress = board["columns"][1]["status_ids"][0]
    response = await move(ctx.http, ctx, first["key"], {"to_status_id": in_progress}, '"v1"')
    assert response.status_code == 200, response.text
    moved = response.json()
    assert moved["status"]["id"] == in_progress
    assert moved["version"] == 2
    assert response.headers["ETag"] == '"v2"'
    board = await get_board(ctx.http, ctx)
    assert keys(board, 0) == [second["key"]]
    assert keys(board, 1) == [first["key"]]
    [activity] = await superuser_sql(
        "SELECT action, field FROM issue_activity WHERE issue_id = :i AND action = 'transitioned'",
        i=uuid.UUID(first["id"]),
    )
    assert (activity.action, activity.field) == ("transitioned", "status")


async def test_move_to_done_sets_done_at_and_back_clears_it(ctx: Ctx) -> None:
    [issue] = await make_issues(ctx, 1)
    board = await get_board(ctx.http, ctx)
    done, todo = board["columns"][3]["status_ids"][0], board["columns"][0]["status_ids"][0]
    assert (
        await move(ctx.http, ctx, issue["key"], {"to_status_id": done}, '"v1"')
    ).status_code == 200
    row = await issue_row(ctx.tenant.org_id, int(issue["key"].split("-")[1]))
    assert row.done_at is not None
    assert (
        await move(ctx.http, ctx, issue["key"], {"to_status_id": todo}, '"v2"')
    ).status_code == 200
    row = await issue_row(ctx.tenant.org_id, int(issue["key"].split("-")[1]))
    assert row.done_at is None


async def test_status_change_requires_if_match_and_rejects_stale_versions(ctx: Ctx) -> None:
    [issue] = await make_issues(ctx, 1)
    target = (await get_board(ctx.http, ctx))["columns"][1]["status_ids"][0]
    missing = await move(ctx.http, ctx, issue["key"], {"to_status_id": target})
    assert missing.status_code == 428
    stale = await move(ctx.http, ctx, issue["key"], {"to_status_id": target}, '"v9"')
    assert stale.status_code == 412
    assert stale.json()["code"] == "version_conflict"
    row = await issue_row(ctx.tenant.org_id, int(issue["key"].split("-")[1]))
    assert row.version == 1


async def test_unknown_status_and_bad_neighbours_are_422_and_write_nothing(ctx: Ctx) -> None:
    first, second = (await make_issues(ctx, 2))[:2]
    unknown = await move(ctx.http, ctx, first["key"], {"to_status_id": str(uuid.uuid4())}, '"v1"')
    assert unknown.status_code == 422
    for body in (
        {"after_key": first["key"]},  # itself
        {"after_key": "WEB-999"},  # missing
        {"after_key": "OTHER-1"},  # other project
        {"after_key": second["key"], "before_key": first["key"]},  # inverted
    ):
        response = await move(ctx.http, ctx, first["key"], body)
        assert response.status_code == 422, body
        assert response.json()["code"] == "invalid_position"
    assert keys(await get_board(ctx.http, ctx), 0) == [first["key"], second["key"]]


async def test_move_validates_the_key_format(ctx: Ctx) -> None:
    [issue] = await make_issues(ctx, 1)
    response = await move(ctx.http, ctx, issue["key"], {"after_key": "not a key"})
    assert response.status_code == 422


async def test_overlong_ranks_trigger_a_project_rebalance(ctx: Ctx) -> None:
    first, second, third = await make_issues(ctx, 3)
    await superuser_sql(
        "UPDATE issues SET rank = :r WHERE org_id = :o AND seq = 1",
        r="1" * 70,
        o=ctx.tenant.org_id,
    )
    await superuser_sql(
        "UPDATE issues SET rank = :r WHERE org_id = :o AND seq = 2",
        r="1" * 70 + "V",
        o=ctx.tenant.org_id,
    )
    response = await move(
        ctx.http, ctx, third["key"], {"after_key": first["key"], "before_key": second["key"]}
    )
    assert response.status_code == 200, response.text
    ranks = await superuser_sql(
        'SELECT seq, rank FROM issues WHERE org_id = :o ORDER BY rank COLLATE "C"',
        o=ctx.tenant.org_id,
    )
    assert [r.seq for r in ranks] == [1, 3, 2]
    assert all(len(r.rank) <= 6 for r in ranks)


# --------------------------------------------------------------------- column config
async def test_put_columns_renames_reorders_sets_wip_and_audits(ctx: Ctx) -> None:
    await make_issues(ctx, 3)
    board = await get_board(ctx.http, ctx)
    columns = [
        {"id": c["id"], "name": c["name"], "status_ids": c["status_ids"]} for c in board["columns"]
    ]
    columns[0]["name"] = "Backlog"
    columns[0]["wip_limit"] = 2
    columns.reverse()
    response = await send(ctx.http, "PUT", f"{board_url(ctx)}/columns", {"columns": columns})
    assert response.status_code == 200, response.text
    updated = response.json()
    assert [c["name"] for c in updated["columns"]][-1] == "Backlog"
    backlog = updated["columns"][-1]
    assert (backlog["wip_limit"], backlog["count"]) == (2, 3)
    assert backlog["over_wip_limit"] is True
    [event] = await superuser_sql(
        "SELECT metadata FROM audit_events WHERE org_id = :o AND action = 'board.columns.updated'",
        o=ctx.tenant.org_id,
    )
    assert event.metadata["columns"] == 4


async def test_put_columns_can_merge_and_add_columns(ctx: Ctx) -> None:
    board = await get_board(ctx.http, ctx)
    todo, progress, review, done = board["columns"]
    columns = [
        {"id": todo["id"], "name": "Open", "status_ids": todo["status_ids"]},
        {"name": "Doing", "status_ids": progress["status_ids"] + review["status_ids"]},
        {"id": done["id"], "name": "Done", "status_ids": done["status_ids"]},
    ]
    response = await send(ctx.http, "PUT", f"{board_url(ctx)}/columns", {"columns": columns})
    assert response.status_code == 200, response.text
    assert [c["name"] for c in response.json()["columns"]] == ["Open", "Doing", "Done"]


async def test_put_columns_requires_every_status_mapped_once(ctx: Ctx) -> None:
    board = await get_board(ctx.http, ctx)
    todo, progress, review, done = board["columns"]
    cases = [
        [{"name": "A", "status_ids": todo["status_ids"] + progress["status_ids"]}],  # missing
        [
            {"name": "A", "status_ids": todo["status_ids"]},
            {
                "name": "B",
                "status_ids": todo["status_ids"]
                + progress["status_ids"]
                + review["status_ids"]
                + done["status_ids"],
            },
        ],  # duplicate
        [
            {
                "id": str(uuid.uuid4()),
                "name": "A",
                "status_ids": todo["status_ids"]
                + progress["status_ids"]
                + review["status_ids"]
                + done["status_ids"],
            }
        ],  # foreign id
    ]
    for columns in cases:
        response = await send(ctx.http, "PUT", f"{board_url(ctx)}/columns", {"columns": columns})
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "invalid_board_columns"
    assert [c["name"] for c in (await get_board(ctx.http, ctx))["columns"]] == [
        "To Do",
        "In Progress",
        "In Review",
        "Done",
    ]


async def test_put_columns_rejects_unknown_fields_and_bad_wip(ctx: Ctx) -> None:
    board = await get_board(ctx.http, ctx)
    column = {"name": "A", "status_ids": [s for c in board["columns"] for s in c["status_ids"]]}
    for extra in ({"org_id": str(uuid.uuid4())}, {"wip_limit": 0}):
        response = await send(
            ctx.http, "PUT", f"{board_url(ctx)}/columns", {"columns": [{**column, **extra}]}
        )
        assert response.status_code == 422
