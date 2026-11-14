"""Issue tester: an optional person on every issue, next to the assignee and reporter."""

import uuid

from tests.integration.auth_support import superuser_sql
from tests.integration.test_comments import new_comment
from tests.integration.test_issues import Ctx, activity, issue_row, new_issue, patch, project_role
from tests.integration.test_issues_hierarchy import transition, transitions_of, workflow_id_of
from tests.integration.test_notifications import inbox
from tests.integration.test_projects import org_member, send

pytest_plugins = ["tests.integration.test_issues"]


async def add_project_member(ctx: Ctx, role: str) -> uuid.UUID:
    _http, user_id = await org_member(ctx.stack, ctx.tenant)
    response = await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/members",
        {"user_id": str(user_id), "role": role},
    )
    assert response.status_code in (201, 204), response.text
    return user_id


async def test_a_new_issue_has_no_tester(ctx: Ctx) -> None:
    created = (await new_issue(ctx.http, ctx)).json()
    assert created["tester"] is None


async def test_the_tester_can_be_set_changed_and_cleared_with_activity(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    member_id = await add_project_member(ctx, "member")

    first = await patch(
        ctx.http, ctx.slug, issue["key"], {"tester_id": str(ctx.tenant.user_id)}, '"v1"'
    )
    assert first.status_code == 200, first.text
    assert first.json()["tester"]["id"] == str(ctx.tenant.user_id)
    second = await patch(ctx.http, ctx.slug, issue["key"], {"tester_id": str(member_id)}, '"v2"')
    assert second.status_code == 200, second.text
    assert second.json()["tester"]["id"] == str(member_id)
    cleared = await patch(ctx.http, ctx.slug, issue["key"], {"tester_id": None}, '"v3"')
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["tester"] is None
    # The assignee is untouched by all of this.
    assert cleared.json()["assignee"] is None

    changes = [a for a in await activity(uuid.UUID(issue["id"])) if a.field == "tester"]
    assert [(c.old_value, c.new_value) for c in changes] == [
        (None, {"id": str(ctx.tenant.user_id)}),
        ({"id": str(ctx.tenant.user_id)}, {"id": str(member_id)}),
        ({"id": str(member_id)}, None),
    ]
    # Sending the same tester again is not a change.
    again = await patch(ctx.http, ctx.slug, issue["key"], {"tester_id": None}, '"v4"')
    assert again.status_code == 200
    assert len([a for a in await activity(uuid.UUID(issue["id"])) if a.field == "tester"]) == 3


async def test_the_tester_must_be_an_active_project_admin_or_member(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    viewer_id = await add_project_member(ctx, "viewer")
    _outsider, outsider_id = await org_member(ctx.stack, ctx.tenant)  # no project role

    for person in (viewer_id, outsider_id, uuid.uuid4()):
        response = await patch(ctx.http, ctx.slug, issue["key"], {"tester_id": str(person)}, '"v1"')
        assert response.status_code == 422, response.text
        assert response.json()["code"] == "invalid_tester"


async def test_the_tester_can_be_set_at_creation(ctx: Ctx) -> None:
    member_id = await add_project_member(ctx, "member")
    created = await new_issue(ctx.http, ctx, ctx.body(tester_id=str(member_id)))
    assert created.status_code == 201, created.text
    assert created.json()["tester"]["id"] == str(member_id)
    bad = await new_issue(ctx.http, ctx, ctx.body(tester_id=str(uuid.uuid4())))
    assert bad.status_code == 422
    assert bad.json()["code"] == "invalid_tester"


async def test_a_project_viewer_cannot_set_the_tester(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    viewer, _ = await project_role(ctx, "viewer")
    denied = await patch(
        viewer, ctx.slug, issue["key"], {"tester_id": str(ctx.tenant.user_id)}, '"v1"'
    )
    assert denied.status_code == 403
    row = await issue_row(ctx.tenant.org_id, 1)
    assert row.tester_id is None


async def test_the_issue_list_filters_by_tester(ctx: Ctx) -> None:
    member_id = await add_project_member(ctx, "member")
    mine = (
        await new_issue(ctx.http, ctx, ctx.body("Mine", tester_id=str(ctx.tenant.user_id)))
    ).json()
    theirs = (await new_issue(ctx.http, ctx, ctx.body("Theirs", tester_id=str(member_id)))).json()
    nobody = (await new_issue(ctx.http, ctx, ctx.body("Nobody"))).json()
    base = f"/api/v1/orgs/{ctx.slug}/issues"

    async def keys(query: str) -> list[str]:
        response = await ctx.http.get(f"{base}?{query}")
        assert response.status_code == 200, response.text
        return sorted(item["key"] for item in response.json()["items"])

    assert await keys("tester=me") == [mine["key"]]
    assert await keys("tester=none") == [nobody["key"]]
    assert await keys(f"tester={member_id}") == [theirs["key"]]
    assert await keys("") == sorted([mine["key"], theirs["key"], nobody["key"]])
    assert (await ctx.http.get(f"{base}?tester=bogus")).status_code == 422


async def test_removing_an_org_member_clears_their_tester_slot(ctx: Ctx) -> None:
    _, member_id = await project_role(ctx, "member")
    await new_issue(ctx.http, ctx)
    await new_issue(ctx.http, ctx)
    await superuser_sql(
        "UPDATE issues SET tester_id = :u WHERE org_id = :o", u=member_id, o=ctx.tenant.org_id
    )
    response = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/members/{member_id}")
    assert response.status_code == 204, response.text
    for seq in (1, 2):
        row = await issue_row(ctx.tenant.org_id, seq)
        assert row.tester_id is None
        assert row.version == 2
        last = (await activity(row.id))[-1]
        assert (last.field, last.actor_id, last.new_value) == ("tester", ctx.tenant.user_id, None)
        assert last.old_value == {"id": str(member_id)}


async def test_the_tester_hears_about_comments_and_status_changes_but_not_the_actor(
    ctx: Ctx,
) -> None:
    tester, tester_id = await project_role(ctx, "member")
    issue = (await new_issue(ctx.http, ctx, ctx.body("Test me", tester_id=str(tester_id)))).json()

    # Setting the tester sends no notification of its own; commenting does.
    assert await inbox(tester, ctx) == []
    assert (await new_comment(ctx.http, ctx.slug, issue["key"])).status_code == 201
    assert [n["type"] for n in await inbox(tester, ctx)] == ["issue_commented"]

    steps = await transitions_of(await workflow_id_of(ctx.tenant.org_id))
    moved = await transition(ctx.http, ctx.slug, issue["key"], steps["In Progress"].id, '"v1"')
    assert moved.status_code == 200, moved.text
    kinds = [n["type"] for n in await inbox(tester, ctx)]
    assert sorted(kinds) == ["issue_commented", "issue_status_changed"]

    # The tester's own comment does not notify themselves.
    await new_comment(tester, ctx.slug, issue["key"])
    assert len(await inbox(tester, ctx)) == 2
