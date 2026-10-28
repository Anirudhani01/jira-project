"""M5: projects, project membership and seeded configuration (plan M5, R3.3 rows 4-8 and
19-20, R7-M5, V3.6 D9). Database-level assertions run as the restricted runtime role."""

import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.db.tenant import TenantContext, bind_tenant
from app.modules.audit import service as audit_service
from tests.integration.auth_support import auth_client, csrf, flush_test_redis, superuser_sql
from tests.integration.tenancy_support import (
    Tenant,
    add_member,
    checksum,
    denied,
    make_tenant,
    verified_user,
)


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


async def create_project(
    actor: httpx.AsyncClient, slug: str, key: str = "WEB", **extra: object
) -> httpx.Response:
    return await actor.post(
        f"/api/v1/orgs/{slug}/projects",
        json={"key": key, "name": "Website", **extra},
        headers={"X-CSRF-Token": await csrf(actor)},
    )


async def send(
    actor: httpx.AsyncClient, method: str, path: str, body: object | None = None
) -> httpx.Response:
    return await actor.request(method, path, json=body, headers={"X-CSRF-Token": await csrf(actor)})


async def org_member(
    stack: AsyncExitStack, tenant: Tenant, role: str = "member", grant: bool = False
) -> tuple[httpx.AsyncClient, uuid.UUID]:
    http = await stack.enter_async_context(auth_client())
    await flush_test_redis()
    _, user_id = await verified_user(http)
    await add_member(tenant.org_id, user_id, role)
    if grant:
        await superuser_sql(
            "UPDATE org_memberships SET can_create_projects = true WHERE org_id = :o AND user_id "
            "= :u",
            o=tenant.org_id,
            u=user_id,
        )
    return http, user_id


async def project_rows(org_id: uuid.UUID, key: str) -> dict[str, int]:
    [row] = await superuser_sql(
        "WITH p AS (SELECT * FROM projects WHERE org_id = :o AND key = :k) SELECT "
        "(SELECT count(*) FROM p) AS projects, "
        "(SELECT count(*) FROM workflows w JOIN p ON p.workflow_id = w.id) AS workflows, "
        "(SELECT count(*) FROM workflow_statuses s JOIN p ON p.workflow_id = s.workflow_id) AS "
        "statuses, "
        "(SELECT count(*) FROM workflow_transitions t JOIN p ON p.workflow_id = t.workflow_id) AS "
        "transitions, "
        "(SELECT count(*) FROM boards b JOIN p ON p.id = b.project_id) AS boards, "
        "(SELECT count(*) FROM board_columns c JOIN boards b ON b.id = c.board_id JOIN p ON p.id "
        "= b.project_id) AS columns, "
        "(SELECT count(*) FROM board_column_statuses m JOIN boards b ON b.id = m.board_id JOIN p "
        "ON p.id = b.project_id) AS mappings, "
        "(SELECT count(*) FROM project_issue_counters c JOIN p ON p.id = c.project_id) AS "
        "counters, "
        "(SELECT count(*) FROM project_memberships m JOIN p ON p.id = m.project_id) AS members",
        o=org_id,
        k=key,
    )
    return dict(row._mapping)


SEEDED = {
    "projects": 1,
    "workflows": 1,
    "statuses": 4,
    "transitions": 4,
    "boards": 1,
    "columns": 4,
    "mappings": 4,
    "counters": 1,
    "members": 1,
}
EMPTY = dict.fromkeys(SEEDED, 0)


# ------------------------------------------------------------------------- creation
async def test_owner_creates_kanban_project_with_seeded_configuration(tenant: Tenant) -> None:
    response = await create_project(tenant.http, tenant.slug, "web")
    assert response.status_code == 201
    assert response.json()["key"] == "WEB"
    assert await project_rows(tenant.org_id, "WEB") == SEEDED
    base = f"/api/v1/orgs/{tenant.slug}/projects/WEB"
    workflow = (await tenant.http.get(f"{base}/workflow")).json()
    assert [s["name"] for s in workflow["statuses"]] == [
        "To Do",
        "In Progress",
        "In Review",
        "Done",
    ]
    assert workflow["initial_status_id"] == workflow["statuses"][0]["id"]
    assert [c["name"] for c in workflow["columns"]] == ["To Do", "In Progress", "In Review", "Done"]
    assert all(len(c["status_ids"]) == 1 for c in workflow["columns"])
    assert all(t["from_status_id"] is None for t in workflow["transitions"])
    [counter] = await superuser_sql(
        "SELECT c.next_seq FROM project_issue_counters c JOIN projects p ON p.id = c.project_id "
        "WHERE p.org_id = :o AND p.key = 'WEB'",
        o=tenant.org_id,
    )
    assert counter.next_seq == 0
    members = (await tenant.http.get(f"{base}/members")).json()["items"]
    assert [(m["user_id"], m["role"]) for m in members] == [(str(tenant.user_id), "admin")]
    actions = await superuser_sql(
        "SELECT action, metadata::text AS md FROM audit_events WHERE org_id = :o AND action LIKE "
        "'project.%'",
        o=tenant.org_id,
    )
    assert [(a.action, a.md) for a in actions] == [("project.created", '{"key": "WEB"}')]


@pytest.mark.parametrize("failing_step", ["board", "audit"])
async def test_creation_is_atomic(
    tenant: Tenant, monkeypatch: pytest.MonkeyPatch, failing_step: str
) -> None:
    async def explode(*args: object, **kwargs: object) -> None:
        raise RuntimeError("injected failure")

    if failing_step == "audit":
        monkeypatch.setattr(audit_service, "record", explode)
    else:
        monkeypatch.setattr("app.modules.projects.repository.Board", None)
    response = await create_project(tenant.http, tenant.slug, "ATOM")
    assert response.status_code == 500
    assert await project_rows(tenant.org_id, "ATOM") == EMPTY


@pytest.mark.parametrize(
    ("key", "status"), [("W", 422), ("1AB", 422), ("ABCDEFGHIJK", 422), ("A-B", 422)]
)
async def test_project_key_format(tenant: Tenant, key: str, status: int) -> None:
    assert (await create_project(tenant.http, tenant.slug, key)).status_code == status


async def test_key_unique_per_org_case_insensitively_and_immutable(tenant: Tenant) -> None:
    assert (await create_project(tenant.http, tenant.slug, "WEB")).status_code == 201
    taken = await create_project(tenant.http, tenant.slug, "web")
    assert taken.status_code == 409
    assert taken.json()["code"] == "project_key_taken"
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
        assert (await create_project(other.http, other.slug, "WEB")).status_code == 201
    renamed = await send(
        tenant.http, "PATCH", f"/api/v1/orgs/{tenant.slug}/projects/WEB", {"key": "NEW"}
    )
    assert renamed.status_code == 422
    assert renamed.json()["code"] == "field_immutable"


async def test_project_creation_follows_d9_option_b(tenant: Tenant) -> None:
    """V3.6: owner/admin may; plain member may not; granted member may; a project admin
    without the grant may not; creating a project does not grant the right."""
    async with AsyncExitStack() as stack:
        admin, _ = await org_member(stack, tenant, "admin")
        member, member_id = await org_member(stack, tenant, "member")
        granted, granted_id = await org_member(stack, tenant, "member", grant=True)
        assert (await create_project(admin, tenant.slug, "ADM")).status_code == 201
        assert (await create_project(member, tenant.slug, "MEM")).status_code == 403
        assert (await create_project(granted, tenant.slug, "GRT")).status_code == 201
        # Project admin of an existing project, without the grant: still cannot create.
        await send(
            tenant.http,
            "POST",
            f"/api/v1/orgs/{tenant.slug}/projects/ADM/members",
            {"user_id": str(member_id), "role": "admin"},
        )
        assert (await create_project(member, tenant.slug, "MEM2")).status_code == 403
        [grant] = await superuser_sql(
            "SELECT can_create_projects FROM org_memberships WHERE org_id = :o AND user_id = :u",
            o=tenant.org_id,
            u=granted_id,
        )
        assert grant.can_create_projects is True  # unchanged by creating a project
        [creator] = await superuser_sql(
            "SELECT can_create_projects FROM org_memberships WHERE org_id = :o AND user_id = :u",
            o=tenant.org_id,
            u=member_id,
        )
        assert creator.can_create_projects is False


async def test_member_without_grant_cannot_insert_a_project_directly(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    async with AsyncExitStack() as stack:
        _, member_id = await org_member(stack, tenant)
    error = await denied(
        rw_engine,
        "INSERT INTO workflows (id, org_id, name, initial_status_id) VALUES (gen_random_uuid(), "
        ":o, 'x', gen_random_uuid())",
        org_id=tenant.org_id,
        user_id=member_id,
        o=tenant.org_id,
    )
    assert "row-level security" in error


# --------------------------------------------------------------- visibility & roles
async def test_project_visibility_and_role_restrictions(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug, "WEB")
    base = f"/api/v1/orgs/{tenant.slug}/projects/WEB"
    async with AsyncExitStack() as stack:
        outsider_in_org, outsider_id = await org_member(stack, tenant)
        viewer, viewer_id = await org_member(stack, tenant)
        admin, _ = await org_member(stack, tenant, "admin")
        unknown = await outsider_in_org.get(f"/api/v1/orgs/{tenant.slug}/projects/NOPE")
        hidden = await outsider_in_org.get(base)
        assert hidden.status_code == unknown.status_code == 404
        assert hidden.json()["code"] == unknown.json()["code"] == "not_found"
        assert (await outsider_in_org.get(f"/api/v1/orgs/{tenant.slug}/projects")).json()[
            "items"
        ] == []
        # Org admins are implicit project admins.
        assert (await admin.get(base)).json()["permissions"] == [
            "issue.create",
            "issue.delete",
            "issue.edit",
            "project.manage",
            "project.members.manage",
            "project.view",
        ]
        await send(
            tenant.http, "POST", f"{base}/members", {"user_id": str(viewer_id), "role": "viewer"}
        )
        assert (await viewer.get(base)).status_code == 200
        assert (await viewer.get(f"{base}/workflow")).status_code == 200
        assert (await send(viewer, "PATCH", base, {"name": "X"})).status_code == 403
        assert (await send(viewer, "POST", f"{base}/archive")).status_code == 403
        assert (
            await send(
                viewer, "POST", f"{base}/members", {"user_id": str(outsider_id), "role": "member"}
            )
        ).status_code == 403
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
        assert (await other.http.get(f"/api/v1/orgs/{tenant.slug}/projects/WEB")).status_code == 404


async def test_project_members_must_be_active_org_members(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug, "WEB")
    base = f"/api/v1/orgs/{tenant.slug}/projects/WEB/members"
    async with AsyncExitStack() as stack:
        stranger = await stack.enter_async_context(auth_client())
        _, stranger_id = await verified_user(stranger)
    response = await send(
        tenant.http, "POST", base, {"user_id": str(stranger_id), "role": "member"}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "not_org_member"


async def test_project_member_role_changes_and_removal_are_audited(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug, "WEB")
    base = f"/api/v1/orgs/{tenant.slug}/projects/WEB/members"
    async with AsyncExitStack() as stack:
        member, member_id = await org_member(stack, tenant)
        assert (
            await send(tenant.http, "POST", base, {"user_id": str(member_id), "role": "member"})
        ).status_code == 204
        assert (
            await send(tenant.http, "POST", base, {"user_id": str(member_id), "role": "member"})
        ).status_code == 409
        assert (
            await send(tenant.http, "PATCH", f"{base}/{member_id}", {"role": "admin"})
        ).status_code == 204
        assert (
            "project.manage"
            in (await member.get(base.removesuffix("/members"))).json()["permissions"]
        )
        assert (await send(tenant.http, "DELETE", f"{base}/{member_id}")).status_code == 204
        assert (await member.get(base.removesuffix("/members"))).status_code == 404
    actions = await superuser_sql(
        "SELECT action FROM audit_events WHERE org_id = :o AND action LIKE 'project.member.%' "
        "ORDER BY id",
        o=tenant.org_id,
    )
    assert [a.action for a in actions] == [
        "project.member.added",
        "project.member.role_changed",
        "project.member.removed",
    ]


async def test_removing_org_member_deletes_their_project_memberships(tenant: Tenant) -> None:
    """Plan R4/R7-M4: same transaction as the org removal."""
    await create_project(tenant.http, tenant.slug, "WEB")
    await create_project(tenant.http, tenant.slug, "API")
    async with AsyncExitStack() as stack:
        _, member_id = await org_member(stack, tenant)
        for key in ("WEB", "API"):
            await send(
                tenant.http,
                "POST",
                f"/api/v1/orgs/{tenant.slug}/projects/{key}/members",
                {"user_id": str(member_id), "role": "member"},
            )
        removed = await send(
            tenant.http, "DELETE", f"/api/v1/orgs/{tenant.slug}/members/{member_id}"
        )
        assert removed.status_code == 204
    [count] = await superuser_sql(
        "SELECT count(*) AS n FROM project_memberships WHERE org_id = :o AND user_id = :u",
        o=tenant.org_id,
        u=member_id,
    )
    assert count.n == 0


async def test_archive_hides_project_and_makes_it_read_only(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug, "WEB")
    base = f"/api/v1/orgs/{tenant.slug}/projects"
    assert (await send(tenant.http, "POST", f"{base}/WEB/archive")).status_code == 204
    assert (await tenant.http.get(base)).json()["items"] == []
    archived = (await tenant.http.get(base, params={"archived": "true"})).json()["items"]
    assert [p["key"] for p in archived] == ["WEB"]
    edit = await send(tenant.http, "PATCH", f"{base}/WEB", {"name": "Renamed"})
    assert edit.status_code == 409
    assert edit.json()["code"] == "project_archived"
    assert (await send(tenant.http, "POST", f"{base}/WEB/unarchive")).status_code == 204
    assert (await send(tenant.http, "PATCH", f"{base}/WEB", {"name": "Renamed"})).json()[
        "name"
    ] == "Renamed"


# ------------------------------------------------------------ database boundaries
async def _project_ids(org_id: uuid.UUID, key: str) -> object:
    [row] = await superuser_sql(
        "SELECT p.id, p.workflow_id, b.id AS board_id, "
        "(SELECT id FROM workflow_statuses WHERE workflow_id = p.workflow_id ORDER BY position "
        "LIMIT 1) AS status_id, "
        "(SELECT id FROM board_columns WHERE board_id = b.id ORDER BY position LIMIT 1) AS "
        "column_id "
        "FROM projects p JOIN boards b ON b.project_id = p.id WHERE p.org_id = :o AND p.key = :k",
        o=org_id,
        k=key,
    )
    return row


async def test_board_column_cannot_map_a_status_from_another_workflow(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    """R7-M5: rejected at the database level (composite FK), even for a project admin."""
    await create_project(tenant.http, tenant.slug, "WEB")
    await create_project(tenant.http, tenant.slug, "API")
    web = await _project_ids(tenant.org_id, "WEB")
    api = await _project_ids(tenant.org_id, "API")
    error = await denied(
        rw_engine,
        "INSERT INTO board_column_statuses (org_id, board_id, workflow_id, column_id, status_id) "
        "VALUES (:o, :board, :wf, :col, :foreign_status)",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        o=tenant.org_id,
        board=web.board_id,  # type: ignore[attr-defined]
        wf=web.workflow_id,  # type: ignore[attr-defined]
        col=web.column_id,  # type: ignore[attr-defined]
        foreign_status=api.status_id,  # type: ignore[attr-defined]
    )
    # The admin passes RLS here; the composite foreign key is what refuses it.
    assert "violates foreign key constraint" in error


@pytest.mark.parametrize(
    "statement",
    [
        # status in A pointing at B's workflow
        "INSERT INTO workflow_statuses (org_id, workflow_id, name, category, position) VALUES "
        "(:a, :b_wf, 'X', 'todo', 9)",
        # transition in A's workflow targeting B's status
        "INSERT INTO workflow_transitions (org_id, workflow_id, name, to_status_id) VALUES (:a, "
        ":a_wf, 'x', :b_status)",
        # A's project member who is a member of B only
        "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES (:a, "
        ":a_project, :b_user, 'member')",
    ],
)
async def test_cross_tenant_references_fail_on_composite_foreign_keys(
    rw_engine: AsyncEngine, statement: str
) -> None:
    """R3.5 test_fk_cross_tenant (M5 tables)."""
    async with AsyncExitStack() as stack:
        a = await make_tenant(stack, "alpha")
        await flush_test_redis()
        b = await make_tenant(stack, "bravo")
        await create_project(a.http, a.slug, "WEB")
        await create_project(b.http, b.slug, "WEB")
    ids_a = await _project_ids(a.org_id, "WEB")
    ids_b = await _project_ids(b.org_id, "WEB")
    before = await checksum()
    error = await denied(
        rw_engine,
        statement,
        org_id=a.org_id,
        user_id=a.user_id,
        a=a.org_id,
        a_wf=ids_a.workflow_id,  # type: ignore[attr-defined]
        a_project=ids_a.id,  # type: ignore[attr-defined]
        b_wf=ids_b.workflow_id,  # type: ignore[attr-defined]
        b_status=ids_b.status_id,  # type: ignore[attr-defined]
        b_user=b.user_id,
    )
    assert "row-level security" in error or "violates foreign key constraint" in error
    assert await checksum() == before
    # Even with RLS out of the way (superuser: inspection of the constraint itself, not a
    # policy test), the composite foreign key alone refuses the cross-tenant reference.
    with pytest.raises(Exception, match="violates foreign key constraint"):
        await superuser_sql(
            statement,
            a=a.org_id,
            a_wf=ids_a.workflow_id,  # type: ignore[attr-defined]
            a_project=ids_a.id,  # type: ignore[attr-defined]
            b_wf=ids_b.workflow_id,  # type: ignore[attr-defined]
            b_status=ids_b.status_id,  # type: ignore[attr-defined]
            b_user=b.user_id,
        )


async def test_workflow_without_its_initial_status_cannot_commit(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    error = await denied(
        rw_engine,
        "INSERT INTO workflows (id, org_id, name, initial_status_id) VALUES (gen_random_uuid(), "
        ":o, 'x', gen_random_uuid())",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        commit=True,
        o=tenant.org_id,
    )
    assert "fk_workflows_org_id_initial_status_workflow_statuses" in error


async def test_project_tables_are_invisible_across_tenants(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    await create_project(tenant.http, tenant.slug, "WEB")
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
    for table in (
        "projects",
        "workflows",
        "workflow_statuses",
        "boards",
        "board_columns",
        "project_memberships",
    ):
        async with AsyncSession(bind=rw_engine) as session, session.begin():
            await bind_tenant(session, TenantContext(org_id=other.org_id, user_id=other.user_id))
            count = (
                await session.execute(
                    text(f"SELECT count(*) FROM {table} WHERE org_id = :o"),  # noqa: S608
                    {"o": tenant.org_id},
                )
            ).scalar_one()
        assert count == 0, table


async def test_project_member_cannot_escalate_or_edit_directly(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    await create_project(tenant.http, tenant.slug, "WEB")
    ids = await _project_ids(tenant.org_id, "WEB")
    async with AsyncExitStack() as stack:
        _, member_id = await org_member(stack, tenant)
    await superuser_sql(
        "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES (:o, :p, :u, "
        "'member')",
        o=tenant.org_id,
        p=ids.id,  # type: ignore[attr-defined]
        u=member_id,
    )
    for statement in (
        "UPDATE project_memberships SET role = 'admin' WHERE project_id = :p",
        "UPDATE projects SET name = 'pwned' WHERE id = :p",
        "DELETE FROM project_memberships WHERE project_id = :p",
    ):
        async with AsyncSession(bind=rw_engine) as session:
            await session.begin()
            await bind_tenant(session, TenantContext(org_id=tenant.org_id, user_id=member_id))
            result = await session.execute(text(statement), {"p": ids.id})  # type: ignore[attr-defined]
            assert result.rowcount == 0, statement  # type: ignore[attr-defined]
            await session.rollback()
    error = await denied(
        rw_engine,
        "UPDATE projects SET key = 'NEW' WHERE id = :p",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        p=ids.id,  # type: ignore[attr-defined]
    )
    assert "permission denied" in error
