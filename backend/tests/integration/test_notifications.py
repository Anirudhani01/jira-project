"""M11: in-app notifications (plan M11, R3.3 row 22, R7-M11): generation rules, recipient
eligibility, actor exclusion and own-only access (API and RLS)."""

import uuid
from typing import Any

import httpx
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.auth_support import csrf, superuser_sql
from tests.integration.tenancy_support import affected, denied, rows
from tests.integration.test_comments import new_comment
from tests.integration.test_issues import Ctx, new_issue, patch, project_role
from tests.integration.test_issues_hierarchy import transition, transitions_of, workflow_id_of
from tests.integration.test_projects import send

pytest_plugins = ["tests.integration.test_issues"]


def url(ctx: Ctx, suffix: str = "") -> str:
    return f"/api/v1/orgs/{ctx.slug}/notifications{suffix}"


async def inbox(http: httpx.AsyncClient, ctx: Ctx, unread: bool = False) -> list[dict[str, Any]]:
    response = await http.get(url(ctx), params={"unread": "true"} if unread else {})
    assert response.status_code == 200, response.text
    return list(response.json()["items"])


async def count(http: httpx.AsyncClient, ctx: Ctx) -> int:
    response = await http.get(url(ctx, "/unread-count"))
    assert response.status_code == 200
    return int(response.json()["count"])


async def team(ctx: Ctx) -> tuple[Any, uuid.UUID, Any, uuid.UUID]:
    """Two project members: a reporter-to-be (A) and an assignee-to-be (B)."""
    a, a_id = await project_role(ctx, "member")
    b, b_id = await project_role(ctx, "member")
    return a, a_id, b, b_id


async def created_by(
    http: httpx.AsyncClient, ctx: Ctx, assignee: uuid.UUID | None = None
) -> dict[str, Any]:
    extra = {"assignee_id": str(assignee)} if assignee else {}
    response = await new_issue(http, ctx, ctx.body("Notify me", **extra))
    assert response.status_code == 201, response.text
    return dict(response.json())


# --------------------------------------------------------------------------- assigned
async def test_assigning_on_create_notifies_the_assignee_not_the_actor(ctx: Ctx) -> None:
    _, _, b, b_id = await team(ctx)
    issue = await created_by(ctx.http, ctx, b_id)
    [item] = await inbox(b, ctx)
    assert item["type"] == "issue_assigned"
    assert item["issue_key"] == issue["key"]
    assert item["read"] is False
    assert item["payload"]["summary"] == "Notify me"
    assert await inbox(ctx.http, ctx) == []
    assert await count(b, ctx) == 1


async def test_reassigning_notifies_the_new_assignee_and_self_assignment_is_silent(
    ctx: Ctx,
) -> None:
    a, a_id, b, b_id = await team(ctx)
    issue = await created_by(a, ctx)
    first = await patch(a, ctx.slug, issue["key"], {"assignee_id": str(b_id)}, '"v1"')
    assert first.status_code == 200, first.text
    assert [n["type"] for n in await inbox(b, ctx)] == ["issue_assigned"]
    second = await patch(a, ctx.slug, issue["key"], {"assignee_id": str(a_id)}, '"v2"')
    assert second.status_code == 200
    assert await inbox(a, ctx) == []  # assigning to yourself notifies nobody
    cleared = await patch(a, ctx.slug, issue["key"], {"assignee_id": None}, '"v3"')
    assert cleared.status_code == 200
    assert len(await inbox(b, ctx)) == 1


# -------------------------------------------------------------------------- commented
async def test_comments_notify_reporter_and_assignee_but_not_the_commenter(ctx: Ctx) -> None:
    a, _, b, b_id = await team(ctx)
    issue = await created_by(a, ctx, b_id)  # A reports, B assigned (B already has 1)
    posted = await new_comment(ctx.http, ctx.slug, issue["key"])  # the owner comments
    assert posted.status_code == 201
    assert [n["type"] for n in await inbox(a, ctx)] == ["issue_commented"]
    assert [n["type"] for n in await inbox(b, ctx)] == ["issue_commented", "issue_assigned"]
    assert await inbox(ctx.http, ctx) == []
    await new_comment(a, ctx.slug, issue["key"])  # the reporter comments on their own issue
    assert len(await inbox(a, ctx)) == 1  # not notified of their own comment
    assert len(await inbox(b, ctx)) == 3


async def test_comment_notifications_carry_no_comment_text(ctx: Ctx) -> None:
    a, *_ = await team(ctx)
    issue = await created_by(a, ctx)
    await new_comment(ctx.http, ctx.slug, issue["key"], {"body": "secret <script>x</script>"})
    [item] = await inbox(a, ctx)
    assert "secret" not in str(item)


async def test_comment_notification_payload_links_to_the_comment(ctx: Ctx) -> None:
    a, *_ = await team(ctx)
    issue = await created_by(a, ctx)
    posted = await new_comment(ctx.http, ctx.slug, issue["key"])
    [item] = await inbox(a, ctx)
    assert item["payload"]["comment_id"] == posted.json()["id"]


# --------------------------------------------------------------------- status changes
async def test_transition_and_board_move_notify_reporter_and_assignee(ctx: Ctx) -> None:
    a, _, b, b_id = await team(ctx)
    issue = await created_by(a, ctx, b_id)
    workflow = await workflow_id_of(ctx.tenant.org_id)
    steps = await transitions_of(workflow)
    done = await transition(ctx.http, ctx.slug, issue["key"], steps["In Progress"].id, '"v1"')
    assert done.status_code == 200, done.text
    [change] = [n for n in await inbox(a, ctx) if n["type"] == "issue_status_changed"]
    assert change["payload"]["to"] == "In Progress"
    assert change["payload"]["from"] == "To Do"
    assert any(n["type"] == "issue_status_changed" for n in await inbox(b, ctx))
    board = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/projects/WEB/board")).json()
    target = board["columns"][3]["status_ids"][0]
    headers = {"X-CSRF-Token": await csrf(ctx.http), "If-Match": '"v2"'}
    moved = await ctx.http.post(
        f"/api/v1/orgs/{ctx.slug}/issues/{issue['key']}/move",
        json={"to_status_id": target},
        headers=headers,
    )
    assert moved.status_code == 200, moved.text
    assert len([n for n in await inbox(a, ctx) if n["type"] == "issue_status_changed"]) == 2


async def test_the_actor_is_excluded_when_they_are_the_reporter_or_assignee(ctx: Ctx) -> None:
    issue = await created_by(ctx.http, ctx)  # owner reports it
    steps = await transitions_of(await workflow_id_of(ctx.tenant.org_id))
    await transition(ctx.http, ctx.slug, issue["key"], steps["In Progress"].id, '"v1"')
    assert await inbox(ctx.http, ctx) == []
    assert await count(ctx.http, ctx) == 0


async def test_people_who_can_no_longer_view_the_project_are_not_notified(ctx: Ctx) -> None:
    a, a_id, *_ = await team(ctx)
    issue = await created_by(a, ctx)
    removed = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/projects/WEB/members/{a_id}")
    assert removed.status_code == 204, removed.text
    await new_comment(ctx.http, ctx.slug, issue["key"])
    assert (
        await superuser_sql(
            "SELECT 1 FROM notifications WHERE org_id = :o AND recipient_id = :r",
            o=ctx.tenant.org_id,
            r=a_id,
        )
        == []
    )


# ----------------------------------------------------------------- read state & access
async def test_mark_read_and_read_all_and_unread_filter(ctx: Ctx) -> None:
    a, *_ = await team(ctx)
    issue = await created_by(a, ctx)
    for _ in range(3):
        await new_comment(ctx.http, ctx.slug, issue["key"])
    assert await count(a, ctx) == 3
    first = (await inbox(a, ctx))[0]
    assert (await send(a, "POST", url(ctx, f"/{first['id']}/read"))).status_code == 204
    assert await count(a, ctx) == 2
    assert len(await inbox(a, ctx, unread=True)) == 2
    assert len(await inbox(a, ctx)) == 3
    done = await send(a, "POST", url(ctx, "/read-all"))
    assert done.json() == {"updated": 2}
    assert await count(a, ctx) == 0


async def test_notifications_are_own_only_through_the_api(ctx: Ctx) -> None:
    a, _, b, b_id = await team(ctx)
    await created_by(ctx.http, ctx, b_id)
    [mine] = await inbox(b, ctx)
    assert await inbox(a, ctx) == []
    assert await count(a, ctx) == 0
    stolen = await send(a, "POST", url(ctx, f"/{mine['id']}/read"))
    assert stolen.status_code == 404
    assert (await send(a, "POST", url(ctx, "/read-all"))).json() == {"updated": 0}
    assert (await inbox(b, ctx, unread=True))[0]["read"] is False


async def test_pagination_follows_the_cursor(ctx: Ctx) -> None:
    a, *_ = await team(ctx)
    issue = await created_by(a, ctx)
    for _ in range(3):
        await new_comment(ctx.http, ctx.slug, issue["key"])
    first = (await a.get(url(ctx), params={"limit": 2})).json()
    assert len(first["items"]) == 2
    assert first["next_cursor"]
    second = (await a.get(url(ctx), params={"limit": 2, "cursor": first["next_cursor"]})).json()
    assert len(second["items"]) == 1
    assert second["next_cursor"] is None
    bad = await a.get(url(ctx), params={"cursor": "not-a-cursor"})
    assert bad.status_code == 400


async def test_rls_hides_and_protects_other_users_notifications(
    ctx: Ctx, rw_engine: AsyncEngine
) -> None:
    _, a_id, _, b_id = await team(ctx)
    await created_by(ctx.http, ctx, b_id)
    org = ctx.tenant.org_id
    assert await rows(rw_engine, "SELECT id FROM notifications", org_id=org, user_id=a_id) == []
    assert len(await rows(rw_engine, "SELECT id FROM notifications", org_id=org, user_id=b_id)) == 1
    stolen = await affected(
        rw_engine, "UPDATE notifications SET read_at = now()", org_id=org, user_id=a_id
    )
    assert stolen == 0
    forged = await denied(
        rw_engine,
        "INSERT INTO notifications (org_id, recipient_id, type, issue_id, actor_id) "
        "SELECT org_id, :r, 'issue_assigned', id, :r FROM issues LIMIT 1",
        org_id=org,
        user_id=a_id,
        r=b_id,
    )
    assert "row-level security" in forged or "violates" in forged
    no_delete = await denied(rw_engine, "DELETE FROM notifications", org_id=org, user_id=b_id)
    assert "permission denied" in no_delete
