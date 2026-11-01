"""A4b.2: workflow PUT API, validation, remap, audit and authorization."""

from __future__ import annotations

import uuid
from contextlib import AsyncExitStack
from typing import Any

import httpx
import pytest

from sqlalchemy.exc import IntegrityError

from app.modules.projects import repository as projects_repository
from tests.integration.auth_support import csrf, superuser_sql
from tests.integration.tenancy_support import Tenant, make_tenant
from tests.integration.test_issues import Ctx, new_issue
from tests.integration.test_projects import create_project, org_member

pytest_plugins = ["tests.integration.test_issues"]


def _body_from_workflow(wf: dict[str, Any], **overrides: object) -> dict[str, Any]:
    body = {
        "name": wf["name"],
        "initial_status_id": wf["initial_status_id"],
        "statuses": [
            {
                "id": s["id"],
                "name": s["name"],
                "category": s["category"],
                "position": s["position"],
            }
            for s in wf["statuses"]
        ],
        "transitions": [
            {
                "id": t["id"],
                "name": t["name"],
                "from_status_id": t["from_status_id"],
                "to_status_id": t["to_status_id"],
            }
            for t in wf["transitions"]
        ],
        "columns": [
            {"id": c.get("id"), "name": c["name"], "status_ids": c["status_ids"]}
            for c in wf["columns"]
        ],
        "status_remaps": [],
    }
    body.update(overrides)
    return body


async def _get_workflow(client: httpx.AsyncClient, slug: str, key: str = "WEB") -> dict[str, Any]:
    response = await client.get(f"/api/v1/orgs/{slug}/projects/{key}/workflow")
    assert response.status_code == 200
    return response.json()


async def _put_workflow(
    client: httpx.AsyncClient,
    slug: str,
    body: dict[str, Any],
    *,
    key: str = "WEB",
    if_match: str | None = None,
    revision: int | None = None,
) -> httpx.Response:
    etag = if_match if if_match is not None else f'"w{revision}"'
    return await client.put(
        f"/api/v1/orgs/{slug}/projects/{key}/workflow",
        json=body,
        headers={"X-CSRF-Token": await csrf(client), "If-Match": etag},
    )


async def _workflow_revision(org_id: uuid.UUID, project_key: str) -> int:
    [row] = await superuser_sql(
        "SELECT w.revision FROM workflows w JOIN projects p ON p.workflow_id = w.id "
        "WHERE p.org_id = :o AND p.key = :k",
        o=org_id,
        k=project_key,
    )
    return int(row.revision)


async def _audit_actions(org_id: uuid.UUID, prefix: str = "workflow.") -> list[str]:
    rows = await superuser_sql(
        "SELECT action FROM audit_events WHERE org_id = :o AND action LIKE :p ORDER BY id",
        o=org_id,
        p=f"{prefix}%",
    )
    return [r.action for r in rows]


@pytest.fixture
async def project_ctx(ctx: Ctx) -> Ctx:
    return ctx


async def test_put_requires_if_match(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Renamed")
    response = await project_ctx.http.put(
        f"/api/v1/orgs/{project_ctx.slug}/projects/WEB/workflow",
        json=body,
        headers={"X-CSRF-Token": await csrf(project_ctx.http)},
    )
    assert response.status_code == 428
    assert response.json()["code"] == "precondition_required"


async def test_put_rejects_malformed_if_match(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Renamed")
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, if_match='"v1"'
    )
    assert response.status_code == 412
    assert response.json()["code"] == "workflow_revision_conflict"


async def test_put_rejects_stale_revision(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="First rename")
    assert wf["revision"] == 1
    ok = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert ok.status_code == 200
    assert ok.json()["revision"] == 2
    stale = await _put_workflow(project_ctx.http, project_ctx.slug, body, revision=1)
    assert stale.status_code == 412
    assert stale.json()["code"] == "workflow_revision_conflict"


async def test_put_no_op_does_not_bump_revision_or_audit(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf)
    before_audit = await _audit_actions(project_ctx.tenant.org_id)
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert response.status_code == 200
    assert response.json()["revision"] == wf["revision"]
    after_audit = await _audit_actions(project_ctx.tenant.org_id)
    assert after_audit == before_audit


async def test_put_metadata_update_bumps_revision_and_audits(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Custom workflow")
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Custom workflow"
    assert response.json()["revision"] == wf["revision"] + 1
    actions = await _audit_actions(project_ctx.tenant.org_id)
    assert "workflow.metadata.updated" in actions


async def test_duplicate_status_name_in_payload(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    statuses = [
        {
            "id": s["id"],
            "name": s["name"],
            "category": s["category"],
            "position": s["position"],
        }
        for s in wf["statuses"]
    ]
    statuses[1]["name"] = statuses[0]["name"]
    body = _body_from_workflow(wf, statuses=statuses)
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert response.status_code == 422
    assert response.json()["code"] == "status_name_taken"


def _workflow_without_status(
    wf: dict[str, Any],
    remove_id: str,
    *,
    remap_to: str | None = None,
) -> dict[str, Any]:
    new_initial = next(s["id"] for s in wf["statuses"] if s["id"] != remove_id)
    statuses = [s for s in wf["statuses"] if s["id"] != remove_id]
    transitions = [
        t
        for t in wf["transitions"]
        if t["to_status_id"] != remove_id
        and (t["from_status_id"] is None or t["from_status_id"] != remove_id)
    ]
    columns = [
        {"name": c["name"], "status_ids": [s for s in c["status_ids"] if s != remove_id]}
        for c in wf["columns"]
        if remove_id not in c["status_ids"]
    ]
    remaps: list[dict[str, str]] = []
    if remap_to is not None:
        remaps = [{"from_status_id": remove_id, "to_status_id": remap_to}]
    return _body_from_workflow(
        wf,
        initial_status_id=new_initial,
        statuses=statuses,
        transitions=transitions,
        columns=columns,
        status_remaps=remaps,
    )


async def test_delete_status_with_issues_requires_remap(project_ctx: Ctx) -> None:
    assert (await new_issue(project_ctx.http, project_ctx)).status_code == 201
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    todo_id = wf["initial_status_id"]
    body = _workflow_without_status(wf, todo_id)
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert response.status_code == 422
    assert response.json()["code"] == "status_in_use"


async def test_delete_status_remaps_issues(project_ctx: Ctx) -> None:
    created = await new_issue(project_ctx.http, project_ctx)
    assert created.status_code == 201
    issue_id = created.json()["id"]
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    todo_id = wf["initial_status_id"]
    target = next(s for s in wf["statuses"] if s["id"] != todo_id)
    body = _workflow_without_status(wf, todo_id, remap_to=target["id"])
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert response.status_code == 200
    [row] = await superuser_sql(
        "SELECT status_id FROM issues WHERE org_id = :o AND id = :id",
        o=project_ctx.tenant.org_id,
        id=issue_id,
    )
    assert str(row.status_id) == target["id"]
    actions = await _audit_actions(project_ctx.tenant.org_id)
    assert "workflow.status.deleted" in actions


async def test_org_owner_can_put_workflow_on_any_project(project_ctx: Ctx) -> None:
    assert (await create_project(project_ctx.http, project_ctx.slug, key="APP")).status_code == 201
    wf = await _get_workflow(project_ctx.http, project_ctx.slug, key="APP")
    body = _body_from_workflow(wf, name="Owner cross-project edit")
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, key="APP", revision=wf["revision"]
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Owner cross-project edit"


async def test_project_member_can_get_workflow(project_ctx: Ctx) -> None:
    [proj] = await superuser_sql(
        "SELECT id FROM projects WHERE org_id = :o AND key = 'WEB'",
        o=project_ctx.tenant.org_id,
    )
    async with AsyncExitStack() as stack:
        member_http, member_id = await org_member(stack, project_ctx.tenant, "member")
        await superuser_sql(
            "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
            "(:o, :p, :u, 'member')",
            o=project_ctx.tenant.org_id,
            p=proj.id,
            u=member_id,
        )
        response = await member_http.get(
            f"/api/v1/orgs/{project_ctx.slug}/projects/WEB/workflow"
        )
    assert response.status_code == 200
    assert "revision" in response.json()


async def test_project_member_cannot_put_workflow(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Blocked")
    [proj] = await superuser_sql(
        "SELECT id FROM projects WHERE org_id = :o AND key = 'WEB'",
        o=project_ctx.tenant.org_id,
    )
    async with AsyncExitStack() as stack:
        member_http, member_id = await org_member(stack, project_ctx.tenant, "member")
        await superuser_sql(
            "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
            "(:o, :p, :u, 'member')",
            o=project_ctx.tenant.org_id,
            p=proj.id,
            u=member_id,
        )
        revision_before = await _workflow_revision(project_ctx.tenant.org_id, "WEB")
        response = await _put_workflow(
            member_http, project_ctx.slug, body, revision=wf["revision"]
        )
        revision_after = await _workflow_revision(project_ctx.tenant.org_id, "WEB")
    assert response.status_code == 403
    assert revision_after == revision_before


async def test_org_admin_can_put_workflow(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Admin edited")
    async with AsyncExitStack() as stack:
        admin_http, _ = await org_member(stack, project_ctx.tenant, "admin")
        response = await _put_workflow(
            admin_http, project_ctx.slug, body, revision=wf["revision"]
        )
    assert response.status_code == 200
    assert response.json()["name"] == "Admin edited"


async def test_org_admin_can_put_workflow_on_another_project(project_ctx: Ctx) -> None:
    assert (await create_project(project_ctx.http, project_ctx.slug, key="APP")).status_code == 201
    wf = await _get_workflow(project_ctx.http, project_ctx.slug, key="APP")
    body = _body_from_workflow(wf, name="Org admin on APP")
    async with AsyncExitStack() as stack:
        admin_http, _ = await org_member(stack, project_ctx.tenant, "admin")
        response = await _put_workflow(
            admin_http, project_ctx.slug, body, key="APP", revision=wf["revision"]
        )
    assert response.status_code == 200
    assert response.json()["name"] == "Org admin on APP"


async def test_project_admin_can_put_own_project_workflow(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Project admin edit")
    [proj] = await superuser_sql(
        "SELECT id FROM projects WHERE org_id = :o AND key = 'WEB'",
        o=project_ctx.tenant.org_id,
    )
    async with AsyncExitStack() as stack:
        admin_http, admin_id = await org_member(stack, project_ctx.tenant, "member")
        await superuser_sql(
            "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
            "(:o, :p, :u, 'admin')",
            o=project_ctx.tenant.org_id,
            p=proj.id,
            u=admin_id,
        )
        response = await _put_workflow(
            admin_http, project_ctx.slug, body, revision=wf["revision"]
        )
    assert response.status_code == 200
    assert response.json()["name"] == "Project admin edit"


async def test_project_admin_cannot_put_another_projects_workflow(project_ctx: Ctx) -> None:
    assert (await create_project(project_ctx.http, project_ctx.slug, key="APP")).status_code == 201
    wf = await _get_workflow(project_ctx.http, project_ctx.slug, key="APP")
    body = _body_from_workflow(wf, name="Should fail")
    [web] = await superuser_sql(
        "SELECT id FROM projects WHERE org_id = :o AND key = 'WEB'",
        o=project_ctx.tenant.org_id,
    )
    async with AsyncExitStack() as stack:
        admin_http, admin_id = await org_member(stack, project_ctx.tenant, "member")
        await superuser_sql(
            "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
            "(:o, :p, :u, 'admin')",
            o=project_ctx.tenant.org_id,
            p=web.id,
            u=admin_id,
        )
        revision_before = await _workflow_revision(project_ctx.tenant.org_id, "APP")
        response = await _put_workflow(
            admin_http, project_ctx.slug, body, key="APP", revision=wf["revision"]
        )
        revision_after = await _workflow_revision(project_ctx.tenant.org_id, "APP")
    assert response.status_code == 404
    assert revision_after == revision_before


async def test_non_member_cannot_access_project_workflow(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Intrusion")
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, prefix="other")
        get_response = await other.http.get(
            f"/api/v1/orgs/{project_ctx.slug}/projects/WEB/workflow"
        )
        put_response = await _put_workflow(
            other.http, project_ctx.slug, body, revision=wf["revision"]
        )
    assert get_response.status_code == 404
    assert put_response.status_code == 404
    assert await _workflow_revision(project_ctx.tenant.org_id, "WEB") == wf["revision"]


async def test_concurrent_puts_adding_same_new_status_name(project_ctx: Ctx) -> None:
    """Database unique index wins; loser is status_name_taken, not a generic 500."""
    import asyncio

    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    new_a, new_b = str(uuid.uuid4()), str(uuid.uuid4())

    def body_with(extra_id: str) -> dict[str, Any]:
        statuses = list(_body_from_workflow(wf)["statuses"])
        statuses.append(
            {"id": extra_id, "name": "QA", "category": "in_progress", "position": 50}
        )
        transitions = list(_body_from_workflow(wf)["transitions"])
        transitions.append(
            {
                "id": str(uuid.uuid4()),
                "name": "To QA",
                "from_status_id": None,
                "to_status_id": extra_id,
            }
        )
        columns = list(_body_from_workflow(wf)["columns"])
        columns.append({"name": "QA", "status_ids": [extra_id]})
        return _body_from_workflow(
            wf, statuses=statuses, transitions=transitions, columns=columns
        )

    results = await asyncio.gather(
        _put_workflow(
            project_ctx.http, project_ctx.slug, body_with(new_a), revision=wf["revision"]
        ),
        _put_workflow(
            project_ctx.http, project_ctx.slug, body_with(new_b), revision=wf["revision"]
        ),
    )
    codes = sorted(r.status_code for r in results)
    assert codes[0] == 200
    assert codes[1] in (412, 422)
    loser = next(r for r in results if r.status_code != 200)
    if loser.status_code == 422:
        assert loser.json()["code"] == "status_name_taken"
    elif loser.status_code == 412:
        assert loser.json()["code"] == "workflow_revision_conflict"
    assert "QA" in [s["name"] for s in (await _get_workflow(project_ctx.http, project_ctx.slug))["statuses"]]


async def test_unrelated_integrity_error_is_not_status_name_taken(
    project_ctx: Ctx, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _Orig:
        constraint_name = "fk_workflow_transitions_org_id_workflow_statuses"
        detail = "foreign key violation"

    async def fail_upsert(*args: object, **kwargs: object) -> None:
        raise IntegrityError("INSERT", {}, _Orig())

    monkeypatch.setattr(projects_repository, "upsert_workflow_statuses", fail_upsert)
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body = _body_from_workflow(wf, name="Should roll back")
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"
    refreshed = await _get_workflow(project_ctx.http, project_ctx.slug)
    assert refreshed["name"] == wf["name"]
    assert refreshed["revision"] == wf["revision"]


async def test_add_status_and_transition(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    new_status_id = str(uuid.uuid4())
    statuses = list(_body_from_workflow(wf)["statuses"])
    statuses.append(
        {
            "id": new_status_id,
            "name": "QA",
            "category": "in_progress",
            "position": 99,
        }
    )
    transitions = list(_body_from_workflow(wf)["transitions"])
    transitions.append(
        {
            "id": str(uuid.uuid4()),
            "name": "To QA",
            "from_status_id": None,
            "to_status_id": new_status_id,
        }
    )
    columns = list(_body_from_workflow(wf)["columns"])
    columns.append({"name": "QA", "status_ids": [new_status_id]})
    body = _body_from_workflow(
        wf, statuses=statuses, transitions=transitions, columns=columns
    )
    response = await _put_workflow(
        project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
    )
    assert response.status_code == 200
    names = [s["name"] for s in response.json()["statuses"]]
    assert "QA" in names
    actions = await _audit_actions(project_ctx.tenant.org_id)
    assert "workflow.status.created" in actions
    assert "workflow.transition.created" in actions
