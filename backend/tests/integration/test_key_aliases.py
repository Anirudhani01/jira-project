"""Phase 1: project key rename and issue relocation (migration 0025).

A renamed project keeps resolving under its old key and the old key stays reserved; an issue
moved to another project keeps resolving under its old ``KEY-n``.
"""

import uuid
from contextlib import AsyncExitStack
from typing import Any

import httpx
import pytest

from tests.integration import test_issues
from tests.integration.auth_support import flush_test_redis, superuser_sql
from tests.integration.tenancy_support import make_tenant
from tests.integration.test_issues import Ctx, activity, new_issue, project_role
from tests.integration.test_projects import create_project, send

ctx = test_issues.ctx  # re-export the fixture so pytest finds it in this module


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


def project_path(slug: str, key: str = "WEB") -> str:
    return f"/api/v1/orgs/{slug}/projects/{key}"


async def rename(http: httpx.AsyncClient, slug: str, new_key: str, key: str = "WEB") -> Any:
    return await send(http, "PATCH", project_path(slug, key), {"key": new_key})


async def relocate(
    http: httpx.AsyncClient,
    slug: str,
    issue_key: str,
    target: str,
    version: str | None = '"v1"',
    **extra: object,
) -> httpx.Response:
    headers = {"X-CSRF-Token": str((await http.get("/api/v1/auth/session")).json()["csrf_token"])}
    if version is not None:
        headers["If-Match"] = version
    return await http.post(
        f"/api/v1/orgs/{slug}/issues/{issue_key}/relocate",
        json={"target_project_key": target, **extra},
        headers=headers,
    )


async def audit_rows(org_id: uuid.UUID, action: str) -> list[str]:
    rows = await superuser_sql(
        "SELECT metadata::text AS md FROM audit_events WHERE org_id = :o AND action = :a "
        "ORDER BY id",
        o=org_id,
        a=action,
    )
    return [r.md for r in rows]


# ------------------------------------------------------------------------ key rename
async def test_owner_renames_key_and_old_key_keeps_working(ctx: Ctx) -> None:
    created = await new_issue(ctx.http, ctx)
    assert created.json()["key"] == "WEB-1"

    renamed = await rename(ctx.http, ctx.slug, "SHOP")
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["key"] == "SHOP"

    by_old_project_key = await ctx.http.get(project_path(ctx.slug, "WEB"))
    assert by_old_project_key.status_code == 200
    assert by_old_project_key.json()["key"] == "SHOP"

    by_old_issue_key = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1")
    assert by_old_issue_key.status_code == 200
    assert by_old_issue_key.json()["key"] == "SHOP-1"  # always the canonical key

    by_new_issue_key = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/SHOP-1")
    assert by_new_issue_key.json()["id"] == by_old_issue_key.json()["id"]
    assert await audit_rows(ctx.tenant.org_id, "project.key_changed") == [
        '{"to": "SHOP", "from": "WEB"}'
    ]


async def test_new_issues_use_the_new_key_and_numbering_continues(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx)
    assert (await rename(ctx.http, ctx.slug, "SHOP")).status_code == 200
    second = await new_issue(ctx.http, ctx, project="SHOP")
    assert second.json()["key"] == "SHOP-2"
    via_old = await new_issue(ctx.http, ctx, project="WEB")  # old key still addresses it
    assert via_old.json()["key"] == "SHOP-3"


async def test_project_admin_who_is_not_org_admin_cannot_rename(ctx: Ctx) -> None:
    http, _ = await project_role(ctx, "admin")
    response = await rename(http, ctx.slug, "SHOP")
    assert response.status_code == 403
    assert (await ctx.http.get(project_path(ctx.slug))).json()["key"] == "WEB"


async def test_retired_key_stays_reserved(ctx: Ctx) -> None:
    assert (await rename(ctx.http, ctx.slug, "SHOP")).status_code == 200
    reuse = await create_project(ctx.http, ctx.slug, key="WEB")
    assert reuse.status_code == 409
    assert reuse.json()["code"] == "project_key_taken"

    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    take_retired = await rename(ctx.http, ctx.slug, "WEB", key="OPS")
    assert take_retired.status_code == 409


async def test_cannot_rename_to_a_live_key(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    response = await rename(ctx.http, ctx.slug, "OPS")
    assert response.status_code == 409
    assert response.json()["code"] == "project_key_taken"


async def test_project_can_take_back_its_own_retired_key(ctx: Ctx) -> None:
    assert (await rename(ctx.http, ctx.slug, "SHOP")).status_code == 200
    back = await rename(ctx.http, ctx.slug, "WEB", key="SHOP")
    assert back.status_code == 200
    assert back.json()["key"] == "WEB"


async def test_invalid_key_is_rejected(ctx: Ctx) -> None:
    assert (await rename(ctx.http, ctx.slug, "1bad")).status_code == 422


async def test_aliases_do_not_leak_across_organizations() -> None:
    async with AsyncExitStack() as stack:
        first = await make_tenant(stack)
        second = await make_tenant(stack)
        assert (await create_project(first.http, first.slug)).status_code == 201
        assert (await create_project(second.http, second.slug)).status_code == 201
        assert (await rename(first.http, first.slug, "SHOP")).status_code == 200
        # The second org's own WEB project is untouched by the first org's alias.
        own = await second.http.get(project_path(second.slug, "WEB"))
        assert own.status_code == 200
        assert own.json()["key"] == "WEB"
        # And the first org's alias is invisible from the second org.
        foreign = await second.http.get(project_path(first.slug, "WEB"))
        assert foreign.status_code == 404


# ------------------------------------------------------------------- issue relocation
async def test_relocate_moves_the_issue_and_keeps_the_old_key(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    created = await new_issue(ctx.http, ctx)
    issue_id = created.json()["id"]

    moved = await relocate(ctx.http, ctx.slug, "WEB-1", "OPS")
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert body["key"] == "OPS-1"
    assert body["id"] == issue_id
    assert body["version"] == 2
    assert body["status"]["name"] == "To Do"  # matched by name in the target workflow
    assert moved.headers["ETag"] == '"v2"'

    old = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1")
    assert old.status_code == 200
    assert old.json()["key"] == "OPS-1"

    history = [a.action for a in await activity(uuid.UUID(issue_id))]
    assert history == ["created", "moved_project"]
    assert await audit_rows(ctx.tenant.org_id, "issue.moved_project") == [
        '{"to": "OPS-1", "from": "WEB-1"}'
    ]
    # The vacated number is never reused.
    again = await new_issue(ctx.http, ctx)
    assert again.json()["key"] == "WEB-2"


async def test_relocate_follows_a_second_move(ctx: Ctx) -> None:
    for key in ("OPS", "DEV"):
        assert (await create_project(ctx.http, ctx.slug, key=key)).status_code == 201
    await new_issue(ctx.http, ctx)
    assert (await relocate(ctx.http, ctx.slug, "WEB-1", "OPS")).status_code == 200
    second = await relocate(ctx.http, ctx.slug, "OPS-1", "DEV", version='"v2"')
    assert second.status_code == 200
    via_first_key = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1")
    assert via_first_key.json()["key"] == "DEV-1"


async def test_relocate_carries_labels_by_name(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    labels = f"/api/v1/orgs/{ctx.slug}/projects"
    bug = await send(ctx.http, "POST", f"{labels}/WEB/labels", {"name": "bug", "color": "#ff0000"})
    # The target already has a label with that name, plus a source-only label.
    await send(ctx.http, "POST", f"{labels}/OPS/labels", {"name": "bug", "color": "#00ff00"})
    ui = await send(ctx.http, "POST", f"{labels}/WEB/labels", {"name": "ui", "color": "#0000ff"})
    created = await new_issue(
        ctx.http, ctx, ctx.body(label_ids=[bug.json()["id"], ui.json()["id"]])
    )
    assert created.status_code == 201, created.text

    moved = await relocate(ctx.http, ctx.slug, "WEB-1", "OPS")
    assert moved.status_code == 200, moved.text
    names = sorted(label["name"] for label in moved.json()["labels"])
    assert names == ["bug", "ui"]
    target_labels = await superuser_sql(
        "SELECT l.name FROM labels l JOIN projects p ON p.id = l.project_id "
        "WHERE p.org_id = :o AND p.key = 'OPS' ORDER BY l.name",
        o=ctx.tenant.org_id,
    )
    assert [r.name for r in target_labels] == ["bug", "ui"]  # reused 'bug', created 'ui'


async def test_relocate_clears_project_scoped_fields(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    created = await new_issue(ctx.http, ctx)
    issue_id = created.json()["id"]
    # Give it a parent-less epic link is not possible across projects; check the columns.
    moved = await relocate(ctx.http, ctx.slug, "WEB-1", "OPS")
    assert moved.status_code == 200
    [row] = await superuser_sql(
        "SELECT sprint_id, fix_version_id, parent_id, project_id FROM issues WHERE id = :i",
        i=uuid.UUID(issue_id),
    )
    assert row.sprint_id is None
    assert row.fix_version_id is None
    assert row.parent_id is None
    [ops] = await superuser_sql(
        "SELECT id FROM projects WHERE org_id = :o AND key = 'OPS'", o=ctx.tenant.org_id
    )
    assert row.project_id == ops.id


async def test_relocate_requires_if_match(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    await new_issue(ctx.http, ctx)
    response = await relocate(ctx.http, ctx.slug, "WEB-1", "OPS", version=None)
    assert response.status_code == 428


async def test_relocate_rejects_a_stale_version(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    await new_issue(ctx.http, ctx)
    response = await relocate(ctx.http, ctx.slug, "WEB-1", "OPS", version='"v9"')
    assert response.status_code == 412


async def test_relocate_rejects_same_and_unknown_project(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx)
    same = await relocate(ctx.http, ctx.slug, "WEB-1", "WEB")
    assert same.status_code == 422
    assert same.json()["code"] == "same_project"
    unknown = await relocate(ctx.http, ctx.slug, "WEB-1", "NOPE")
    assert unknown.status_code == 404


async def test_issues_with_children_and_subtasks_cannot_move(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    parent = (await new_issue(ctx.http, ctx)).json()
    child = await new_issue(
        ctx.http, ctx, ctx.body("Sub", type_id=str(ctx.types["subtask"]), parent_id=parent["id"])
    )
    assert child.status_code == 201, child.text

    with_children = await relocate(ctx.http, ctx.slug, parent["key"], "OPS")
    assert with_children.status_code == 422
    assert with_children.json()["code"] == "has_children"

    subtask = await relocate(ctx.http, ctx.slug, child.json()["key"], "OPS")
    assert subtask.status_code == 422
    assert subtask.json()["code"] == "subtask_not_movable"


async def test_relocate_detaches_a_parent_epic(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    epic = (await new_issue(ctx.http, ctx, ctx.body("Epic", type_id=str(ctx.types["epic"])))).json()
    story = await new_issue(ctx.http, ctx, ctx.body("Story", parent_id=epic["id"]))
    assert story.status_code == 201, story.text
    moved = await relocate(ctx.http, ctx.slug, story.json()["key"], "OPS")
    assert moved.status_code == 200, moved.text
    assert moved.json()["parent"] is None


async def test_viewer_cannot_relocate(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    await new_issue(ctx.http, ctx)
    http, _ = await project_role(ctx, "viewer")
    response = await relocate(http, ctx.slug, "WEB-1", "OPS")
    assert response.status_code == 403


async def test_member_needs_access_to_the_target_project(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="OPS")).status_code == 201
    await new_issue(ctx.http, ctx)
    http, user_id = await project_role(ctx, "member")
    # Member of WEB only: OPS looks like an unknown project.
    assert (await relocate(http, ctx.slug, "WEB-1", "OPS")).status_code == 404
    # Viewer on the target is visible but cannot create issues there.
    added = await send(
        ctx.http,
        "POST",
        f"{project_path(ctx.slug, 'OPS')}/members",
        {"user_id": str(user_id), "role": "viewer"},
    )
    assert added.status_code == 204, added.text
    assert (await relocate(http, ctx.slug, "WEB-1", "OPS")).status_code == 403
    # A member on both projects may move it.
    promoted = await send(
        ctx.http,
        "PATCH",
        f"{project_path(ctx.slug, 'OPS')}/members/{user_id}",
        {"role": "member"},
    )
    assert promoted.status_code in (200, 204), promoted.text
    assert (await relocate(http, ctx.slug, "WEB-1", "OPS")).status_code == 200


async def test_relocate_cannot_cross_organizations() -> None:
    async with AsyncExitStack() as stack:
        first = await make_tenant(stack)
        second = await make_tenant(stack)
        assert (await create_project(first.http, first.slug)).status_code == 201
        assert (await create_project(second.http, second.slug, key="OPS")).status_code == 201
        # The second org's owner cannot even see the first org's issue.
        response = await relocate(second.http, first.slug, "WEB-1", "OPS")
        assert response.status_code == 404
