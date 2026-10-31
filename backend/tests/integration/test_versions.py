"""Versions / releases: lifecycle, access, fix-version assignment, release and delete rules."""

import uuid
from typing import Any

import httpx

from tests.integration.auth_support import superuser_sql
from tests.integration.test_issues import Ctx, new_issue, patch, project_role
from tests.integration.test_issues_hierarchy import transition, transitions_of, workflow_id_of
from tests.integration.test_projects import create_project, org_member, send

pytest_plugins = ["tests.integration.test_issues"]


def base(ctx: Ctx, project: str = "WEB") -> str:
    return f"/api/v1/orgs/{ctx.slug}/projects/{project}/versions"


def vurl(ctx: Ctx, version_id: str, suffix: str = "") -> str:
    return f"/api/v1/orgs/{ctx.slug}/versions/{version_id}{suffix}"


async def version(
    ctx: Ctx, name: str = "1.0", http: httpx.AsyncClient | None = None, **extra: Any
) -> dict[str, Any]:
    response = await send(http or ctx.http, "POST", base(ctx), {"name": name, **extra})
    assert response.status_code == 201, response.text
    return dict(response.json())


async def issue(ctx: Ctx, summary: str = "Work", **extra: Any) -> dict[str, Any]:
    response = await new_issue(ctx.http, ctx, ctx.body(summary, **extra))
    assert response.status_code == 201, response.text
    return dict(response.json())


async def assign(ctx: Ctx, item: dict[str, Any], version_id: str | None) -> dict[str, Any]:
    current = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{item['key']}")).json()
    response = await patch(
        ctx.http, ctx.slug, item["key"], {"fix_version_id": version_id}, f'"v{current["version"]}"'
    )
    assert response.status_code == 200, response.text
    return dict(response.json())


async def finish(ctx: Ctx, item: dict[str, Any]) -> None:
    current = (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{item['key']}")).json()
    steps = await transitions_of(await workflow_id_of(ctx.tenant.org_id))
    done = await transition(
        ctx.http, ctx.slug, item["key"], steps["Done"].id, f'"v{current["version"]}"'
    )
    assert done.status_code == 200, done.text


async def listed(ctx: Ctx, **params: str) -> list[dict[str, Any]]:
    response = await ctx.http.get(base(ctx), params=params)
    assert response.status_code == 200, response.text
    return list(response.json()["items"])


# ----------------------------------------------------------------------------- CRUD
async def test_create_list_edit_and_reorder_versions(ctx: Ctx) -> None:
    first = await version(
        ctx, "1.0", description="First", start_date="2026-11-01", release_date="2026-12-01"
    )
    second = await version(ctx, "2.0")
    assert (first["status"], first["position"], second["position"]) == ("unreleased", 0, 1)
    assert [v["name"] for v in await listed(ctx)] == ["1.0", "2.0"]
    edited = await send(
        ctx.http, "PATCH", vurl(ctx, first["id"]), {"name": "1.0.1", "description": None}
    )
    assert edited.status_code == 200, edited.text
    assert (edited.json()["name"], edited.json()["description"]) == ("1.0.1", None)
    order = await send(ctx.http, "PUT", f"{base(ctx)}/order", {"ids": [second["id"], first["id"]]})
    assert order.status_code == 200
    assert [v["name"] for v in order.json()["items"]] == ["2.0", "1.0.1"]
    bad = await send(ctx.http, "PUT", f"{base(ctx)}/order", {"ids": [second["id"], second["id"]]})
    assert bad.status_code == 422
    assert (
        await send(ctx.http, "PUT", f"{base(ctx)}/order", {"ids": [str(uuid.uuid4())]})
    ).status_code == 422


async def test_names_are_unique_per_project_ignoring_case_and_dates_must_be_ordered(
    ctx: Ctx,
) -> None:
    await version(ctx, "Phoenix")
    duplicate = await send(ctx.http, "POST", base(ctx), {"name": "phoenix"})
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "version_name_taken"
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    assert (await send(ctx.http, "POST", base(ctx, "APP"), {"name": "Phoenix"})).status_code == 201
    inverted = await send(
        ctx.http,
        "POST",
        base(ctx),
        {"name": "X", "start_date": "2026-12-01", "release_date": "2026-11-01"},
    )
    assert inverted.status_code == 422
    other = await version(ctx, "Y", start_date="2026-12-01")
    patched = await send(ctx.http, "PATCH", vurl(ctx, other["id"]), {"release_date": "2026-11-01"})
    assert patched.status_code == 422
    assert patched.json()["code"] == "invalid_dates"
    for body in (
        {"name": ""},
        {"name": "a" * 101},
        {"status": "released"},
        {"name": "Z", "extra": 1},
    ):
        assert (await send(ctx.http, "POST", base(ctx), body)).status_code == 422, body


async def test_only_project_admins_manage_versions_everyone_with_access_reads(ctx: Ctx) -> None:
    created = await version(ctx)
    member, _ = await project_role(ctx, "member")
    viewer, _ = await project_role(ctx, "viewer")
    outsider, _ = await org_member(ctx.stack, ctx.tenant)
    for http in (member, viewer):
        assert (await http.get(base(ctx))).status_code == 200
        assert (await send(http, "POST", base(ctx), {"name": "Nope"})).status_code == 403
        assert (
            await send(http, "PATCH", vurl(ctx, created["id"]), {"name": "Nope"})
        ).status_code == 403
        assert (
            await send(http, "POST", vurl(ctx, created["id"], "/release"), {})
        ).status_code == 403
        assert (await send(http, "DELETE", vurl(ctx, created["id"]))).status_code == 403
    assert (await outsider.get(base(ctx))).status_code == 404
    assert (await send(outsider, "DELETE", vurl(ctx, created["id"]))).status_code == 404
    assert (await ctx.http.get(vurl(ctx, str(uuid.uuid4())))).status_code in (404, 405)


# ------------------------------------------------------------------- assignment
async def test_assigning_a_fix_version_bumps_version_logs_activity_and_can_be_cleared(
    ctx: Ctx,
) -> None:
    v1 = await version(ctx, "1.0")
    work = await issue(ctx)
    assert work["fix_version"] is None
    changed = await assign(ctx, work, v1["id"])
    assert changed["fix_version"] == {"id": v1["id"], "name": "1.0", "status": "unreleased"}
    assert changed["version"] == work["version"] + 1
    [entry] = await superuser_sql(
        "SELECT old_value, new_value FROM issue_activity "
        "WHERE issue_id = :i AND field = 'fix_version'",
        i=uuid.UUID(work["id"]),
    )
    assert entry.old_value is None
    assert entry.new_value["name"] == "1.0"
    cleared = await assign(ctx, changed, None)
    assert cleared["fix_version"] is None
    created = await issue(ctx, "Born with a version", fix_version_id=v1["id"])
    assert created["fix_version"]["name"] == "1.0"


async def test_fix_version_must_belong_to_the_project_and_not_be_archived(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    foreign = (await send(ctx.http, "POST", base(ctx, "APP"), {"name": "Elsewhere"})).json()
    old = await version(ctx, "Old")
    assert (await send(ctx.http, "POST", vurl(ctx, old["id"], "/archive"))).status_code == 200
    work = await issue(ctx)
    for bad in (foreign["id"], old["id"], str(uuid.uuid4())):
        rejected = await patch(ctx.http, ctx.slug, work["key"], {"fix_version_id": bad}, '"v1"')
        assert rejected.status_code == 422, bad
        assert rejected.json()["errors"][0]["field"] == "body.fix_version_id"
        assert (
            await new_issue(ctx.http, ctx, ctx.body("X", fix_version_id=bad))
        ).status_code == 422


async def test_version_counts_follow_the_status_category_of_its_issues(ctx: Ctx) -> None:
    v1 = await version(ctx)
    a, b, c = await issue(ctx, "A"), await issue(ctx, "B"), await issue(ctx, "C")
    for item in (a, b, c):
        await assign(ctx, item, v1["id"])
    await finish(ctx, a)
    [row] = await listed(ctx)
    assert (row["issue_count"], row["todo_count"], row["done_count"]) == (3, 2, 1)


# --------------------------------------------------------------------- release
async def test_release_marks_the_version_released_sets_the_date_and_cannot_repeat(ctx: Ctx) -> None:
    v1 = await version(ctx, "1.0", start_date="2026-01-01")
    released = await send(
        ctx.http, "POST", vurl(ctx, v1["id"], "/release"), {"release_date": "2026-11-15"}
    )
    assert released.status_code == 200, released.text
    body = released.json()["version"]
    assert (body["status"], body["release_date"]) == ("released", "2026-11-15")
    assert body["released_at"] is not None
    again = await send(ctx.http, "POST", vurl(ctx, v1["id"], "/release"), {})
    assert again.status_code == 409
    assert again.json()["code"] == "version_not_unreleased"
    unreleased = await send(ctx.http, "POST", vurl(ctx, v1["id"], "/unrelease"))
    assert unreleased.json()["status"] == "unreleased"
    assert unreleased.json()["released_at"] is None
    assert (await send(ctx.http, "POST", vurl(ctx, v1["id"], "/unrelease"))).status_code == 409
    early = await send(
        ctx.http, "POST", vurl(ctx, v1["id"], "/release"), {"release_date": "2025-01-01"}
    )
    assert early.status_code == 422


async def test_release_can_move_only_unresolved_issues_to_another_version(ctx: Ctx) -> None:
    v1, v2 = await version(ctx, "1.0"), await version(ctx, "2.0")
    done, open_one = await issue(ctx, "Done"), await issue(ctx, "Open")
    for item in (done, open_one):
        await assign(ctx, item, v1["id"])
    await finish(ctx, done)
    needs_target = await send(
        ctx.http, "POST", vurl(ctx, v1["id"], "/release"), {"unresolved": "move"}
    )
    assert needs_target.status_code == 422
    result = await send(
        ctx.http,
        "POST",
        vurl(ctx, v1["id"], "/release"),
        {"unresolved": "move", "move_to": v2["id"]},
    )
    assert result.status_code == 200, result.text
    assert result.json()["moved_issues"] == 1
    rows = await superuser_sql(
        "SELECT summary, fix_version_id FROM issues WHERE org_id = :o ORDER BY summary",
        o=ctx.tenant.org_id,
    )
    by_summary = {r.summary: str(r.fix_version_id) for r in rows}
    assert by_summary == {"Done": v1["id"], "Open": v2["id"]}
    [event] = await superuser_sql(
        "SELECT metadata FROM audit_events WHERE org_id = :o AND action = 'version.released'",
        o=ctx.tenant.org_id,
    )
    assert event.metadata["moved"] == 1


async def test_release_ignoring_unresolved_issues_leaves_them_and_rejects_bad_targets(
    ctx: Ctx,
) -> None:
    v1, v2 = await version(ctx, "1.0"), await version(ctx, "2.0")
    open_one = await issue(ctx, "Stays")
    await assign(ctx, open_one, v1["id"])
    for body in (
        {"unresolved": "move", "move_to": v1["id"]},  # itself
        {"unresolved": "move", "move_to": str(uuid.uuid4())},
    ):
        bad = await send(ctx.http, "POST", vurl(ctx, v1["id"], "/release"), body)
        assert bad.status_code == 422, body
        assert bad.json()["code"] == "invalid_target_version"
    ok = await send(ctx.http, "POST", vurl(ctx, v1["id"], "/release"), {"unresolved": "ignore"})
    assert ok.json()["moved_issues"] == 0
    [row] = await superuser_sql(
        "SELECT fix_version_id FROM issues WHERE org_id = :o", o=ctx.tenant.org_id
    )
    assert str(row.fix_version_id) == v1["id"]
    assert v2


# --------------------------------------------------------------------- archive
async def test_archive_hides_the_version_and_unarchive_restores_its_previous_state(
    ctx: Ctx,
) -> None:
    v1, v2 = await version(ctx, "1.0"), await version(ctx, "2.0")
    await send(ctx.http, "POST", vurl(ctx, v2["id"], "/release"), {})
    archived = await send(ctx.http, "POST", vurl(ctx, v1["id"], "/archive"))
    assert archived.json()["status"] == "archived"
    assert (await send(ctx.http, "POST", vurl(ctx, v1["id"], "/archive"))).status_code == 409
    assert [v["name"] for v in await listed(ctx)] == ["2.0"]
    assert {v["name"] for v in await listed(ctx, include_archived="true")} == {"1.0", "2.0"}
    assert (await send(ctx.http, "POST", vurl(ctx, v1["id"], "/unarchive"))).json()[
        "status"
    ] == "unreleased"
    await send(ctx.http, "POST", vurl(ctx, v2["id"], "/archive"))
    assert (await send(ctx.http, "POST", vurl(ctx, v2["id"], "/unarchive"))).json()[
        "status"
    ] == "released"
    assert (await send(ctx.http, "POST", vurl(ctx, v2["id"], "/unarchive"))).status_code == 409


# ------------------------------------------------------------------------ delete
async def test_delete_moves_issues_to_another_version_or_clears_them(ctx: Ctx) -> None:
    v1, v2, v3 = await version(ctx, "1.0"), await version(ctx, "2.0"), await version(ctx, "3.0")
    a, b = await issue(ctx, "A"), await issue(ctx, "B")
    await assign(ctx, a, v1["id"])
    await assign(ctx, b, v2["id"])
    moved = await send(ctx.http, "DELETE", f"{vurl(ctx, v1['id'])}?move_to={v3['id']}")
    assert moved.status_code == 204, moved.text
    cleared = await send(ctx.http, "DELETE", vurl(ctx, v2["id"]))
    assert cleared.status_code == 204
    rows = await superuser_sql(
        "SELECT summary, fix_version_id FROM issues WHERE org_id = :o ORDER BY summary",
        o=ctx.tenant.org_id,
    )
    assert {r.summary: (str(r.fix_version_id) if r.fix_version_id else None) for r in rows} == {
        "A": v3["id"],
        "B": None,
    }
    assert [v["name"] for v in await listed(ctx)] == ["3.0"]
    audited = await superuser_sql(
        "SELECT count(*) AS n FROM audit_events WHERE org_id = :o AND action = 'version.deleted'",
        o=ctx.tenant.org_id,
    )
    assert audited[0].n == 2
    bad = await send(ctx.http, "DELETE", f"{vurl(ctx, v3['id'])}?move_to={v3['id']}")
    assert bad.status_code == 422


async def test_deleting_a_project_scoped_version_never_touches_other_projects(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    web = await version(ctx, "1.0")
    app = (await send(ctx.http, "POST", base(ctx, "APP"), {"name": "1.0"})).json()
    foreign_target = await send(ctx.http, "DELETE", f"{vurl(ctx, web['id'])}?move_to={app['id']}")
    assert foreign_target.status_code == 422
    assert (await send(ctx.http, "DELETE", vurl(ctx, web["id"]))).status_code == 204
    assert [v["name"] for v in (await ctx.http.get(base(ctx, "APP"))).json()["items"]] == ["1.0"]
