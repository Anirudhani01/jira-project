"""M7: transitions, assignment, labels, hierarchy (plan M7, R3.3 rows 10/12/14/16, R4,
R7-M7). Reuses the M6 ``Ctx`` fixture and helpers; database-level assertions run as the
restricted runtime role unless they need the superuser (fixture setup, raw inspection)."""

import uuid
from typing import Any

import httpx

from tests.integration.auth_support import superuser_sql
from tests.integration.test_issues import Ctx, activity, issue_row, new_issue, patch, project_role
from tests.integration.test_projects import create_project, org_member, send

# Loads the ``ctx`` and (autouse) ``_clean_rate_limits`` fixtures from test_issues without
# binding their names at module level, which would shadow every ``ctx: Ctx`` parameter.
pytest_plugins = ["tests.integration.test_issues"]


async def _csrf(http: httpx.AsyncClient) -> str:
    return str((await http.get("/api/v1/auth/session")).json()["csrf_token"])


async def transition(
    http: httpx.AsyncClient, slug: str, key: str, transition_id: uuid.UUID, if_match: str | None
) -> httpx.Response:
    headers = {"X-CSRF-Token": await _csrf(http)}
    if if_match is not None:
        headers["If-Match"] = if_match
    return await http.post(
        f"/api/v1/orgs/{slug}/issues/{key}/transitions",
        json={"transition_id": str(transition_id)},
        headers=headers,
    )


async def transitions_of(workflow_id: uuid.UUID) -> dict[str, Any]:
    """Keyed by the target status name; each row carries the transition's own ``id`` and
    the target status's ``status_id``, ``status_name`` and ``category`` -- distinct
    things an activity entry's ``new_value`` is checked against (``status_id``, not the
    transition id)."""
    rows = await superuser_sql(
        "SELECT t.id, t.name, s.id AS status_id, s.name AS status_name, s.category "
        "FROM workflow_transitions t JOIN workflow_statuses s ON s.id = t.to_status_id "
        "WHERE t.workflow_id = :w",
        w=workflow_id,
    )
    return {r.status_name: r for r in rows}


async def workflow_id_of(org_id: uuid.UUID, project_key: str = "WEB") -> uuid.UUID:
    [row] = await superuser_sql(
        "SELECT workflow_id FROM projects WHERE org_id = :o AND key = :k", o=org_id, k=project_key
    )
    return uuid.UUID(str(row.workflow_id))


async def create_label(
    http: httpx.AsyncClient, slug: str, name: str = "bug", color: str = "#FF0000"
) -> httpx.Response:
    return await send(
        http, "POST", f"/api/v1/orgs/{slug}/projects/WEB/labels", {"name": name, "color": color}
    )


# ----------------------------------------------------------------------- hierarchy
async def test_epic_standard_subtask_tree_rules(ctx: Ctx) -> None:
    epic = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"])))).json()
    story = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body("Story", type_id=str(ctx.types["standard"]), parent_id=epic["id"]),
        )
    ).json()
    assert story["parent"] == {"id": epic["id"], "key": epic["key"], "summary": epic["summary"]}
    subtask = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body("Sub", type_id=str(ctx.types["subtask"]), parent_id=story["id"]),
        )
    ).json()
    assert subtask["parent"]["id"] == story["id"]

    # A standard issue's parent must be an epic.
    bad_parent = await new_issue(
        ctx.http, ctx, ctx.body(type_id=str(ctx.types["standard"]), parent_id=story["id"])
    )
    assert bad_parent.status_code == 422
    assert bad_parent.json()["code"] == "invalid_parent_kind"

    # A sub-task's parent must be a standard issue, not an epic.
    subtask_under_epic = await new_issue(
        ctx.http, ctx, ctx.body(type_id=str(ctx.types["subtask"]), parent_id=epic["id"])
    )
    assert subtask_under_epic.status_code == 422
    assert subtask_under_epic.json()["code"] == "invalid_parent_kind"

    # An epic cannot have a parent.
    epic_with_parent = await new_issue(
        ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"]), parent_id=epic["id"])
    )
    assert epic_with_parent.status_code == 422
    assert epic_with_parent.json()["code"] == "epic_cannot_have_parent"

    # Unknown / cross-project parent.
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    unknown = await new_issue(
        ctx.http, ctx, ctx.body(type_id=str(ctx.types["standard"]), parent_id=str(uuid.uuid4()))
    )
    assert unknown.status_code == 422
    assert unknown.json()["code"] == "invalid_parent"
    other_project_epic = await new_issue(
        ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"])), project="APP"
    )
    cross_project = await new_issue(
        ctx.http,
        ctx,
        ctx.body(type_id=str(ctx.types["standard"]), parent_id=other_project_epic.json()["id"]),
    )
    assert cross_project.status_code == 422
    assert cross_project.json()["code"] == "invalid_parent"


async def test_reparenting_and_detaching_are_tracked_in_activity(ctx: Ctx) -> None:
    epic1 = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"])))).json()
    epic2 = (
        await new_issue(ctx.http, ctx, ctx.body("Epic 2", type_id=str(ctx.types["epic"])))
    ).json()
    story = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body("Story", type_id=str(ctx.types["standard"]), parent_id=epic1["id"]),
        )
    ).json()

    moved = await patch(ctx.http, ctx.slug, story["key"], {"parent_id": epic2["id"]}, '"v1"')
    assert moved.status_code == 200, moved.text
    assert moved.json()["parent"]["id"] == epic2["id"]
    changes = [a for a in await activity(uuid.UUID(story["id"])) if a.field == "parent"]
    assert changes[-1].old_value == {"id": epic1["id"], "key": epic1["key"]}
    assert changes[-1].new_value == {"id": epic2["id"], "key": epic2["key"]}

    detached = await patch(ctx.http, ctx.slug, story["key"], {"parent_id": None}, '"v2"')
    assert detached.status_code == 200
    assert detached.json()["parent"] is None

    subtask = (
        await new_issue(
            ctx.http, ctx, ctx.body("Sub", type_id=str(ctx.types["subtask"]), parent_id=story["id"])
        )
    ).json()
    # A sub-task cannot be detached: it must always have a parent.
    cannot_detach = await patch(ctx.http, ctx.slug, subtask["key"], {"parent_id": None}, '"v1"')
    assert cannot_detach.status_code == 422
    assert cannot_detach.json()["code"] == "subtask_requires_parent"


async def test_changing_type_is_blocked_while_the_issue_has_children(ctx: Ctx) -> None:
    epic = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"])))).json()
    await new_issue(
        ctx.http,
        ctx,
        ctx.body("Story", type_id=str(ctx.types["standard"]), parent_id=epic["id"]),
    )
    blocked = await patch(
        ctx.http, ctx.slug, epic["key"], {"type_id": str(ctx.types["standard"])}, '"v1"'
    )
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "issue_has_children"
    # A childless, parentless issue can still change type freely.
    standalone = (await new_issue(ctx.http, ctx, ctx.body("Standalone"))).json()
    ok = await patch(
        ctx.http, ctx.slug, standalone["key"], {"type_id": str(ctx.types["epic"])}, '"v1"'
    )
    assert ok.status_code == 200


async def test_self_parent_via_simultaneous_type_and_parent_change_is_a_clean_422(
    ctx: Ctx,
) -> None:
    """A standard issue's own (pre-update) kind satisfies the subtask/parent-kind check,
    so without an explicit self-reference guard this would reach the database's
    ``ck_issues_parent_not_self`` CHECK constraint as an unhandled 500 instead of a 422."""
    issue = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["standard"])))).json()
    response = await patch(
        ctx.http,
        ctx.slug,
        issue["key"],
        {"type_id": str(ctx.types["subtask"]), "parent_id": issue["id"]},
        '"v1"',
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "parent_cannot_be_self"
    row = await issue_row(ctx.tenant.org_id, int(issue["key"].split("-")[1]))
    assert row.version == 1
    assert row.type_id == ctx.types["standard"]
    assert row.parent_id is None
    assert len(await activity(uuid.UUID(issue["id"]))) == 1  # only "created"


async def test_self_parent_via_epic_to_standard_type_change_is_a_clean_422(ctx: Ctx) -> None:
    """Closely related combination: an epic's own (pre-update) kind can likewise satisfy
    the parent-kind check for a type change into ``standard``."""
    issue = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"])))).json()
    response = await patch(
        ctx.http,
        ctx.slug,
        issue["key"],
        {"type_id": str(ctx.types["standard"]), "parent_id": issue["id"]},
        '"v1"',
    )
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "parent_cannot_be_self"
    row = await issue_row(ctx.tenant.org_id, int(issue["key"].split("-")[1]))
    assert row.version == 1
    assert row.type_id == ctx.types["epic"]
    assert row.parent_id is None


async def test_self_parent_without_a_type_change_is_also_rejected(ctx: Ctx) -> None:
    """The guard applies even when ``type_id`` is not part of the request."""
    issue = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["standard"])))).json()
    response = await patch(ctx.http, ctx.slug, issue["key"], {"parent_id": issue["id"]}, '"v1"')
    assert response.status_code == 422, response.text
    assert response.json()["code"] == "parent_cannot_be_self"


# -------------------------------------------------------------------------- children
async def test_children_endpoint_lists_direct_children_only(ctx: Ctx) -> None:
    epic = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"])))).json()
    story = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body("Story", type_id=str(ctx.types["standard"]), parent_id=epic["id"]),
        )
    ).json()
    subtask = (
        await new_issue(
            ctx.http, ctx, ctx.body("Sub", type_id=str(ctx.types["subtask"]), parent_id=story["id"])
        )
    ).json()

    epic_children = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{epic['key']}/children")
    epic_body = epic_children.json()
    assert [c["id"] for c in epic_body["items"]] == [story["id"]]
    assert epic_body["total"] == 1
    assert epic_body["done"] == 0
    story_children = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{story['key']}/children")
    assert [c["id"] for c in story_children.json()["items"]] == [subtask["id"]]
    subtask_children = await ctx.http.get(
        f"/api/v1/orgs/{ctx.slug}/issues/{subtask['key']}/children"
    )
    assert subtask_children.json()["items"] == []


# ----------------------------------------------------------------------------- delete
async def test_deleting_a_standard_issue_cascades_to_its_subtasks(ctx: Ctx) -> None:
    story = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["standard"])))).json()
    subtask = (
        await new_issue(
            ctx.http, ctx, ctx.body("Sub", type_id=str(ctx.types["subtask"]), parent_id=story["id"])
        )
    ).json()
    response = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/issues/{story['key']}")
    assert response.status_code == 204
    assert (
        await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{subtask['key']}")
    ).status_code == 404
    row = await issue_row(ctx.tenant.org_id, int(subtask["key"].split("-")[1]))
    assert row.deleted_at is not None
    assert row.version == 2
    [*_, last] = await activity(uuid.UUID(subtask["id"]))
    assert (last.action, last.field) == ("deleted", "parent")


async def test_deleting_an_epic_detaches_its_children(ctx: Ctx) -> None:
    epic = (await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["epic"])))).json()
    story = (
        await new_issue(
            ctx.http,
            ctx,
            ctx.body("Story", type_id=str(ctx.types["standard"]), parent_id=epic["id"]),
        )
    ).json()
    response = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/issues/{epic['key']}")
    assert response.status_code == 204
    fetched = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{story['key']}")
    assert fetched.status_code == 200
    assert fetched.json()["parent"] is None
    row = await issue_row(ctx.tenant.org_id, int(story["key"].split("-")[1]))
    assert row.deleted_at is None
    assert row.version == 2
    [*_, last] = await activity(uuid.UUID(story["id"]))
    assert (last.action, last.field, last.new_value) == ("updated", "parent", None)


# -------------------------------------------------------------------------- assignee
async def test_assignee_must_be_an_active_project_admin_or_member(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    _member, member_id = await org_member(ctx.stack, ctx.tenant)
    await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/members",
        {"user_id": str(member_id), "role": "member"},
    )
    _viewer, viewer_id = await org_member(ctx.stack, ctx.tenant)
    await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/members",
        {"user_id": str(viewer_id), "role": "viewer"},
    )
    _outsider, outsider_id = await org_member(ctx.stack, ctx.tenant)  # no project role

    # Org owner (the creator) is an implicit project admin: eligible without a membership.
    as_owner = await patch(
        ctx.http, ctx.slug, issue["key"], {"assignee_id": str(ctx.tenant.user_id)}, '"v1"'
    )
    assert as_owner.status_code == 200
    as_member = await patch(
        ctx.http, ctx.slug, issue["key"], {"assignee_id": str(member_id)}, '"v2"'
    )
    assert as_member.status_code == 200, as_member.text
    assert as_member.json()["assignee"]["id"] == str(member_id)

    as_viewer = await patch(
        ctx.http, ctx.slug, issue["key"], {"assignee_id": str(viewer_id)}, '"v3"'
    )
    assert as_viewer.status_code == 422
    assert as_viewer.json()["code"] == "invalid_assignee"
    as_outsider = await patch(
        ctx.http, ctx.slug, issue["key"], {"assignee_id": str(outsider_id)}, '"v3"'
    )
    assert as_outsider.status_code == 422
    as_stranger = await patch(
        ctx.http, ctx.slug, issue["key"], {"assignee_id": str(uuid.uuid4())}, '"v3"'
    )
    assert as_stranger.status_code == 422

    unassigned = await patch(ctx.http, ctx.slug, issue["key"], {"assignee_id": None}, '"v3"')
    assert unassigned.status_code == 200
    assert unassigned.json()["assignee"] is None
    changes = [a for a in await activity(uuid.UUID(issue["id"])) if a.field == "assignee"]
    assert [c.new_value for c in changes][:2] == [
        {"id": str(ctx.tenant.user_id)},
        {"id": str(member_id)},
    ]
    assert changes[-1].new_value is None


async def test_assignee_can_be_set_at_creation(ctx: Ctx) -> None:
    _member, member_id = await org_member(ctx.stack, ctx.tenant)
    await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/members",
        {"user_id": str(member_id), "role": "member"},
    )
    created = await new_issue(ctx.http, ctx, ctx.body(assignee_id=str(member_id)))
    assert created.status_code == 201
    assert created.json()["assignee"]["id"] == str(member_id)
    bad = await new_issue(ctx.http, ctx, ctx.body(assignee_id=str(uuid.uuid4())))
    assert bad.status_code == 422
    assert bad.json()["code"] == "invalid_assignee"


# ------------------------------------------------------------------------ transitions
async def test_transitions_are_listed_and_applied_with_if_match(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    workflow_id = await workflow_id_of(ctx.tenant.org_id)
    by_status = await transitions_of(workflow_id)
    assert {r.status_name for r in by_status.values()} == {
        "To Do",
        "In Progress",
        "In Review",
        "Done",
    }

    listed = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{issue['key']}/transitions")
    assert listed.status_code == 200
    assert {t["to_status"]["name"] for t in listed.json()["items"]} == {
        "To Do",
        "In Progress",
        "In Review",
        "Done",
    }

    done = by_status["Done"]
    missing_if_match = await transition(ctx.http, ctx.slug, issue["key"], done.id, None)
    assert missing_if_match.status_code == 428
    stale = await transition(ctx.http, ctx.slug, issue["key"], done.id, '"v9"')
    assert stale.status_code == 412

    applied = await transition(ctx.http, ctx.slug, issue["key"], done.id, '"v1"')
    assert applied.status_code == 200, applied.text
    assert applied.json()["status"]["name"] == "Done"
    assert applied.json()["version"] == 2
    assert applied.headers["ETag"] == '"v2"'
    row = await issue_row(ctx.tenant.org_id, int(issue["key"].split("-")[1]))
    assert row.done_at is not None
    [*_, last] = await activity(uuid.UUID(issue["id"]))
    assert (last.action, last.field) == ("transitioned", "status")
    assert last.new_value == {"id": str(done.status_id), "name": "Done"}

    todo = by_status["To Do"]
    back = await transition(ctx.http, ctx.slug, issue["key"], todo.id, '"v2"')
    assert back.status_code == 200
    row = await issue_row(ctx.tenant.org_id, int(issue["key"].split("-")[1]))
    assert row.done_at is None  # leaving Done clears it


async def test_transition_rejects_unknown_and_out_of_workflow_ids(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    unknown = await transition(ctx.http, ctx.slug, issue["key"], uuid.uuid4(), '"v1"')
    assert unknown.status_code == 422
    assert unknown.json()["code"] == "invalid_transition"

    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    other_workflow = await workflow_id_of(ctx.tenant.org_id, "APP")
    [other_transition] = await superuser_sql(
        "SELECT id FROM workflow_transitions WHERE workflow_id = :w LIMIT 1", w=other_workflow
    )
    cross_workflow = await transition(ctx.http, ctx.slug, issue["key"], other_transition.id, '"v1"')
    assert cross_workflow.status_code == 422
    assert cross_workflow.json()["code"] == "invalid_transition"


async def test_transition_restricted_to_a_specific_status_is_enforced(ctx: Ctx) -> None:
    """The seeded default workflow allows any status -> any status; this exercises the
    ``from_status_id`` restriction path (invariant 6) with a workflow row inserted
    directly, as a project with a non-default workflow would have."""
    issue = (await new_issue(ctx.http, ctx)).json()
    workflow_id = await workflow_id_of(ctx.tenant.org_id)
    [todo_id] = await superuser_sql(
        "SELECT id FROM workflow_statuses WHERE workflow_id = :w AND name = 'To Do'", w=workflow_id
    )
    [restricted] = await superuser_sql(
        "INSERT INTO workflow_transitions (org_id, workflow_id, name, from_status_id, "
        "to_status_id) SELECT :o, :w, 'Done -> To Do only', s.id, :todo "
        "FROM workflow_statuses s WHERE s.workflow_id = :w AND s.name = 'Done' RETURNING id",
        o=ctx.tenant.org_id,
        w=workflow_id,
        todo=todo_id.id,
    )
    # The issue starts in "To Do", which is not the restricted transition's from-status.
    not_permitted = await transition(ctx.http, ctx.slug, issue["key"], restricted.id, '"v1"')
    assert not_permitted.status_code == 422
    assert not_permitted.json()["code"] == "transition_not_permitted"


async def test_only_project_members_and_admins_may_transition(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    workflow_id = await workflow_id_of(ctx.tenant.org_id)
    by_status = await transitions_of(workflow_id)
    viewer, _ = await project_role(ctx, "viewer")
    member, _ = await project_role(ctx, "member")
    forbidden = await transition(viewer, ctx.slug, issue["key"], by_status["Done"].id, '"v1"')
    assert forbidden.status_code == 403
    allowed = await transition(member, ctx.slug, issue["key"], by_status["Done"].id, '"v1"')
    assert allowed.status_code == 200


# ----------------------------------------------------------------------------- labels
async def test_label_crud_and_permissions(ctx: Ctx) -> None:
    created = await create_label(ctx.http, ctx.slug, "bug", "#FF0000")
    assert created.status_code == 201, created.text
    label = created.json()
    assert (label["name"], label["color"]) == ("bug", "#FF0000")

    duplicate = await create_label(ctx.http, ctx.slug, "bug", "#00FF00")
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "label_name_taken"

    bad_color = await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/labels",
        {"name": "x", "color": "red"},
    )
    assert bad_color.status_code == 422

    member, _ = await org_member(ctx.stack, ctx.tenant)
    listed = await member.get(f"/api/v1/orgs/{ctx.slug}/projects/WEB/labels")
    assert listed.status_code == 404  # no project role: same as an unknown project

    project_member, member_id = await org_member(ctx.stack, ctx.tenant)
    await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/members",
        {"user_id": str(member_id), "role": "member"},
    )
    member_create = await send(
        project_member,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/labels",
        {"name": "wontfix", "color": "#000000"},
    )
    assert member_create.status_code == 403  # labels are project-admin territory

    member_list = await project_member.get(f"/api/v1/orgs/{ctx.slug}/projects/WEB/labels")
    assert member_list.status_code == 200
    assert [i["name"] for i in member_list.json()["items"]] == ["bug"]

    deleted = await send(
        ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/projects/WEB/labels/{label['id']}"
    )
    assert deleted.status_code == 204
    again = await send(
        ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/projects/WEB/labels/{label['id']}"
    )
    assert again.status_code == 404


async def test_labels_can_be_set_on_create_and_replaced_on_update(ctx: Ctx) -> None:
    bug = (await create_label(ctx.http, ctx.slug, "bug", "#FF0000")).json()
    ux = (await create_label(ctx.http, ctx.slug, "ux", "#00FF00")).json()

    created = await new_issue(ctx.http, ctx, ctx.body(label_ids=[bug["id"]]))
    assert created.status_code == 201
    assert [lbl["name"] for lbl in created.json()["labels"]] == ["bug"]
    issue = created.json()

    unknown = await new_issue(ctx.http, ctx, ctx.body(label_ids=[str(uuid.uuid4())]))
    assert unknown.status_code == 422
    assert unknown.json()["code"] == "invalid_label"

    replaced = await patch(
        ctx.http, ctx.slug, issue["key"], {"label_ids": [bug["id"], ux["id"]]}, '"v1"'
    )
    assert replaced.status_code == 200, replaced.text
    assert sorted(lbl["name"] for lbl in replaced.json()["labels"]) == ["bug", "ux"]
    changes = [a for a in await activity(uuid.UUID(issue["id"])) if a.field == "labels"]
    assert changes[-1].old_value == [{"id": bug["id"], "name": "bug"}]
    assert changes[-1].new_value == [
        {"id": bug["id"], "name": "bug"},
        {"id": ux["id"], "name": "ux"},
    ]

    cleared = await patch(ctx.http, ctx.slug, issue["key"], {"label_ids": []}, '"v2"')
    assert cleared.status_code == 200
    assert cleared.json()["labels"] == []

    no_op = await patch(ctx.http, ctx.slug, issue["key"], {"label_ids": []}, '"v3"')
    assert no_op.json()["version"] == 3  # already empty: no bump, no activity

    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    other_project_label = await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/APP/labels",
        {"name": "other", "color": "#654321"},
    )
    assert other_project_label.status_code == 201
    not_this_project = await patch(
        ctx.http, ctx.slug, issue["key"], {"label_ids": [other_project_label.json()["id"]]}, '"v3"'
    )
    assert not_this_project.status_code == 422
    assert not_this_project.json()["code"] == "invalid_label"
