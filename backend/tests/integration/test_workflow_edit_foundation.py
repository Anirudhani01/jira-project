"""A4b.1: workflow revision column, grants and RLS for future graph editing."""

import uuid
from contextlib import AsyncExitStack

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.db.tenant import TenantContext, bind_tenant
from tests.integration.auth_support import superuser_sql
from tests.integration.tenancy_support import Tenant, affected, denied, make_tenant
from tests.integration.test_issues import Ctx, _config, new_issue
from tests.integration.test_projects import create_project, org_member

pytest_plugins = ["tests.integration.test_projects"]


async def _workflow_revision(org_id: uuid.UUID, project_key: str) -> int:
    [row] = await superuser_sql(
        "SELECT w.revision FROM workflows w JOIN projects p ON p.workflow_id = w.id "
        "WHERE p.org_id = :o AND p.key = :k",
        o=org_id,
        k=project_key,
    )
    return int(row.revision)


async def _two_status_ids(org_id: uuid.UUID, workflow_id: uuid.UUID) -> tuple[uuid.UUID, uuid.UUID]:
    rows = await superuser_sql(
        "SELECT id FROM workflow_statuses WHERE org_id = :o AND workflow_id = :w ORDER BY position "
        "LIMIT 2",
        o=org_id,
        w=workflow_id,
    )
    return rows[0].id, rows[1].id


async def _project_admin(
    stack: AsyncExitStack, tenant: Tenant, project_id: uuid.UUID
) -> uuid.UUID:
    _, admin_id = await org_member(stack, tenant)
    await superuser_sql(
        "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
        "(:o, :p, :u, 'admin')",
        o=tenant.org_id,
        p=project_id,
        u=admin_id,
    )
    return admin_id


async def _project_context(org_id: uuid.UUID, key: str) -> object:
    [row] = await superuser_sql(
        "SELECT p.id AS project_id, p.workflow_id, "
        "(SELECT id FROM workflow_statuses WHERE workflow_id = p.workflow_id ORDER BY position "
        "LIMIT 1) AS status_id, "
        "(SELECT id FROM workflow_transitions WHERE workflow_id = p.workflow_id LIMIT 1) AS "
        "transition_id "
        "FROM projects p WHERE p.org_id = :o AND p.key = :k",
        o=org_id,
        k=key,
    )
    return row


@pytest.fixture
async def seeded_project(tenant: Tenant) -> Tenant:
    assert (await create_project(tenant.http, tenant.slug, "WEB")).status_code == 201
    return tenant


async def test_existing_workflows_default_revision_one(seeded_project: Tenant) -> None:
    assert await _workflow_revision(seeded_project.org_id, "WEB") == 1


async def test_new_project_workflow_starts_at_revision_one(tenant: Tenant) -> None:
    assert (await create_project(tenant.http, tenant.slug, "NEW")).status_code == 201
    assert await _workflow_revision(tenant.org_id, "NEW") == 1


async def test_revision_check_rejects_non_positive_values(seeded_project: Tenant) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    for bad in (0, -1):
        with pytest.raises(DBAPIError, match="workflows_revision_positive"):
            await superuser_sql(
                "UPDATE workflows SET revision = :r WHERE id = :w",
                r=bad,
                w=ctx.workflow_id,  # type: ignore[attr-defined]
            )


async def test_org_owner_can_update_workflow_graph(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    assert (
        await affected(
            rw_engine,
            "UPDATE workflows SET name = 'Renamed workflow' WHERE id = :w",
            org_id=seeded_project.org_id,
            user_id=seeded_project.user_id,
            w=ctx.workflow_id,  # type: ignore[attr-defined]
        )
        == 1
    )
    assert (
        await affected(
            rw_engine,
            "UPDATE workflow_statuses SET name = 'Backlog' WHERE id = :s",
            org_id=seeded_project.org_id,
            user_id=seeded_project.user_id,
            s=ctx.status_id,  # type: ignore[attr-defined]
        )
        == 1
    )
    assert (
        await affected(
            rw_engine,
            "UPDATE workflow_transitions SET name = 'Start work' WHERE id = :t",
            org_id=seeded_project.org_id,
            user_id=seeded_project.user_id,
            t=ctx.transition_id,  # type: ignore[attr-defined]
        )
        == 1
    )


async def test_org_admin_can_update_workflow_graph(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    async with AsyncExitStack() as stack:
        _, admin_id = await org_member(stack, seeded_project, "admin")
    ctx = await _project_context(seeded_project.org_id, "WEB")
    assert (
        await affected(
            rw_engine,
            "UPDATE workflow_statuses SET position = 0 WHERE id = :s",
            org_id=seeded_project.org_id,
            user_id=admin_id,
            s=ctx.status_id,  # type: ignore[attr-defined]
        )
        == 1
    )


async def test_project_admin_can_update_own_project_workflow(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    async with AsyncExitStack() as stack:
        admin_id = await _project_admin(
            stack, seeded_project, ctx.project_id  # type: ignore[attr-defined]
        )
    assert (
        await affected(
            rw_engine,
            "UPDATE workflows SET name = 'Admin rename' WHERE id = :w",
            org_id=seeded_project.org_id,
            user_id=admin_id,
            w=ctx.workflow_id,  # type: ignore[attr-defined]
        )
        == 1
    )


async def test_project_admin_insert_status(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    async with AsyncExitStack() as stack:
        admin_id = await _project_admin(
            stack, seeded_project, ctx.project_id  # type: ignore[attr-defined]
        )
    new_id = uuid.uuid4()
    assert (
        await affected(
            rw_engine,
            "INSERT INTO workflow_statuses (id, org_id, workflow_id, name, category, position) "
            "VALUES (:id, :o, :w, 'QA', 'in_progress', 50)",
            org_id=seeded_project.org_id,
            user_id=admin_id,
            id=new_id,
            o=seeded_project.org_id,
            w=ctx.workflow_id,  # type: ignore[attr-defined]
        )
        == 1
    )


async def test_project_admin_update_status(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    async with AsyncExitStack() as stack:
        admin_id = await _project_admin(
            stack, seeded_project, ctx.project_id  # type: ignore[attr-defined]
        )
    assert (
        await affected(
            rw_engine,
            "UPDATE workflow_statuses SET name = 'Ready' WHERE id = :s",
            org_id=seeded_project.org_id,
            user_id=admin_id,
            s=ctx.status_id,  # type: ignore[attr-defined]
        )
        == 1
    )


async def test_project_admin_delete_unused_status(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    async with AsyncExitStack() as stack:
        admin_id = await _project_admin(
            stack, seeded_project, ctx.project_id  # type: ignore[attr-defined]
        )
    new_id = uuid.uuid4()
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_tenant(
            session, TenantContext(org_id=seeded_project.org_id, user_id=admin_id)
        )
        await session.execute(
            text(
                "INSERT INTO workflow_statuses (id, org_id, workflow_id, name, category, position) "
                "VALUES (:id, :o, :w, 'Ephemeral', 'todo', 99)"
            ),
            {"id": new_id, "o": seeded_project.org_id, "w": ctx.workflow_id},  # type: ignore[attr-defined]
        )
        deleted = await session.execute(
            text("DELETE FROM workflow_statuses WHERE id = :id"),
            {"id": new_id},
        )
        assert deleted.rowcount == 1  # type: ignore[attr-defined]
        await session.rollback()


async def test_project_admin_insert_update_delete_transition(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    from_id, to_id = await _two_status_ids(
        seeded_project.org_id, ctx.workflow_id  # type: ignore[attr-defined]
    )
    async with AsyncExitStack() as stack:
        admin_id = await _project_admin(
            stack, seeded_project, ctx.project_id  # type: ignore[attr-defined]
        )
    transition_id = uuid.uuid4()
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_tenant(
            session, TenantContext(org_id=seeded_project.org_id, user_id=admin_id)
        )
        inserted = await session.execute(
            text(
                "INSERT INTO workflow_transitions (id, org_id, workflow_id, name, from_status_id, "
                "to_status_id) VALUES (:id, :o, :w, 'Quick', :f, :t)"
            ),
            {
                "id": transition_id,
                "o": seeded_project.org_id,
                "w": ctx.workflow_id,  # type: ignore[attr-defined]
                "f": from_id,
                "t": to_id,
            },
        )
        updated = await session.execute(
            text("UPDATE workflow_transitions SET name = 'Quick rename' WHERE id = :id"),
            {"id": transition_id},
        )
        deleted = await session.execute(
            text("DELETE FROM workflow_transitions WHERE id = :id"),
            {"id": transition_id},
        )
        assert inserted.rowcount == 1  # type: ignore[attr-defined]
        assert updated.rowcount == 1  # type: ignore[attr-defined]
        assert deleted.rowcount == 1  # type: ignore[attr-defined]
        await session.rollback()


async def test_org_admin_can_mutate_any_project_workflow(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    assert (await create_project(seeded_project.http, seeded_project.slug, "API")).status_code == 201
    api = await _project_context(seeded_project.org_id, "API")
    async with AsyncExitStack() as stack:
        _, org_admin_id = await org_member(stack, seeded_project, "admin")
    assert (
        await affected(
            rw_engine,
            "UPDATE workflow_statuses SET name = 'Org admin edit' WHERE id = :s",
            org_id=seeded_project.org_id,
            user_id=org_admin_id,
            s=api.status_id,  # type: ignore[attr-defined]
        )
        == 1
    )


async def test_app_rw_cannot_delete_workflow_row(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    error = await denied(
        rw_engine,
        "DELETE FROM workflows WHERE id = :w",
        org_id=seeded_project.org_id,
        user_id=seeded_project.user_id,
        w=ctx.workflow_id,  # type: ignore[attr-defined]
    )
    assert "permission denied" in error.lower()


GRAPH_WRITE_OPS = (
    (
        "insert_status",
        "INSERT INTO workflow_statuses (org_id, workflow_id, name, category, position) VALUES "
        "(:o, :w, 'Denied', 'todo', 88)",
        "rls",
    ),
    (
        "update_status",
        "UPDATE workflow_statuses SET name = 'Denied' WHERE id = :s",
        "zero",
    ),
    (
        "delete_status",
        "DELETE FROM workflow_statuses WHERE id = :s",
        "zero",
    ),
    (
        "insert_transition",
        "INSERT INTO workflow_transitions (org_id, workflow_id, name, from_status_id, "
        "to_status_id) VALUES (:o, :w, 'Denied', :s, :s2)",
        "rls",
    ),
    (
        "update_transition",
        "UPDATE workflow_transitions SET name = 'Denied' WHERE id = :t",
        "zero",
    ),
    (
        "delete_transition",
        "DELETE FROM workflow_transitions WHERE id = :t",
        "zero",
    ),
)


@pytest.mark.parametrize("op_name,statement,denial", GRAPH_WRITE_OPS)
async def test_project_member_graph_writes_denied(
    rw_engine: AsyncEngine,
    seeded_project: Tenant,
    op_name: str,
    statement: str,
    denial: str,
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    _, to_id = await _two_status_ids(
        seeded_project.org_id, ctx.workflow_id  # type: ignore[attr-defined]
    )
    async with AsyncExitStack() as stack:
        _, member_id = await org_member(stack, seeded_project)
        await superuser_sql(
            "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
            "(:o, :p, :u, 'member')",
            o=seeded_project.org_id,
            p=ctx.project_id,  # type: ignore[attr-defined]
            u=member_id,
        )
    params = {
        "o": seeded_project.org_id,
        "w": ctx.workflow_id,  # type: ignore[attr-defined]
        "s": ctx.status_id,  # type: ignore[attr-defined]
        "s2": to_id,
        "t": ctx.transition_id,  # type: ignore[attr-defined]
    }
    if denial == "zero":
        assert (
            await affected(
                rw_engine,
                statement,
                org_id=seeded_project.org_id,
                user_id=member_id,
                **params,
            )
            == 0
        ), op_name
    else:
        error = await denied(
            rw_engine,
            statement,
            org_id=seeded_project.org_id,
            user_id=member_id,
            **params,
        )
        assert "row-level security" in error, op_name


@pytest.mark.parametrize("op_name,statement,denial", GRAPH_WRITE_OPS)
async def test_project_admin_other_project_graph_writes_denied(
    rw_engine: AsyncEngine,
    seeded_project: Tenant,
    op_name: str,
    statement: str,
    denial: str,
) -> None:
    assert (await create_project(seeded_project.http, seeded_project.slug, "API")).status_code == 201
    web = await _project_context(seeded_project.org_id, "WEB")
    api = await _project_context(seeded_project.org_id, "API")
    _, to_id = await _two_status_ids(
        seeded_project.org_id, api.workflow_id  # type: ignore[attr-defined]
    )
    async with AsyncExitStack() as stack:
        admin_id = await _project_admin(
            stack, seeded_project, web.project_id  # type: ignore[attr-defined]
        )
    params = {
        "o": seeded_project.org_id,
        "w": api.workflow_id,  # type: ignore[attr-defined]
        "s": api.status_id,  # type: ignore[attr-defined]
        "s2": to_id,
        "t": api.transition_id,  # type: ignore[attr-defined]
    }
    if denial == "zero":
        assert (
            await affected(
                rw_engine,
                statement,
                org_id=seeded_project.org_id,
                user_id=admin_id,
                **params,
            )
            == 0
        ), op_name
    else:
        error = await denied(
            rw_engine,
            statement,
            org_id=seeded_project.org_id,
            user_id=admin_id,
            **params,
        )
        assert "row-level security" in error, op_name


async def test_status_delete_blocked_while_mapped_on_board_column(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    [row] = await superuser_sql(
        "SELECT bcs.status_id FROM board_column_statuses bcs "
        "JOIN boards b ON b.id = bcs.board_id WHERE b.project_id = :p LIMIT 1",
        p=ctx.project_id,  # type: ignore[attr-defined]
    )
    error = await denied(
        rw_engine,
        "DELETE FROM workflow_statuses WHERE id = :s",
        org_id=seeded_project.org_id,
        user_id=seeded_project.user_id,
        commit=True,
        s=row.status_id,
    )
    assert "violates foreign key constraint" in error


async def test_project_admin_cannot_update_another_projects_workflow(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    assert (await create_project(seeded_project.http, seeded_project.slug, "API")).status_code == 201
    web = await _project_context(seeded_project.org_id, "WEB")
    api = await _project_context(seeded_project.org_id, "API")
    async with AsyncExitStack() as stack:
        _, admin_id = await org_member(stack, seeded_project)
        await superuser_sql(
            "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
            "(:o, :p, :u, 'admin')",
            o=seeded_project.org_id,
            p=web.project_id,  # type: ignore[attr-defined]
            u=admin_id,
        )
    assert (
        await affected(
            rw_engine,
            "UPDATE workflow_statuses SET name = 'blocked' WHERE id = :s",
            org_id=seeded_project.org_id,
            user_id=admin_id,
            s=api.status_id,  # type: ignore[attr-defined]
        )
        == 0
    )


async def test_project_member_cannot_update_workflow_definitions(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    async with AsyncExitStack() as stack:
        _, member_id = await org_member(stack, seeded_project)
        await superuser_sql(
            "INSERT INTO project_memberships (org_id, project_id, user_id, role) VALUES "
            "(:o, :p, :u, 'member')",
            o=seeded_project.org_id,
            p=ctx.project_id,  # type: ignore[attr-defined]
            u=member_id,
        )
    params = {
        "w": ctx.workflow_id,  # type: ignore[attr-defined]
        "s": ctx.status_id,  # type: ignore[attr-defined]
        "o": seeded_project.org_id,
    }
    for statement in (
        "UPDATE workflows SET name = 'x' WHERE id = :w",
        "UPDATE workflow_statuses SET name = 'x' WHERE id = :s",
        "DELETE FROM workflow_statuses WHERE id = :s",
    ):
        assert (
            await affected(
                rw_engine,
                statement,
                org_id=seeded_project.org_id,
                user_id=member_id,
                **params,
            )
            == 0
        ), statement
    insert_error = await denied(
        rw_engine,
        "INSERT INTO workflow_statuses (org_id, workflow_id, name, category, position) VALUES "
        "(:o, :w, 'Extra', 'todo', 99)",
        org_id=seeded_project.org_id,
        user_id=member_id,
        **params,
    )
    assert "row-level security" in insert_error


async def test_cross_organization_workflow_update_is_denied(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
    assert (
        await affected(
            rw_engine,
            "UPDATE workflows SET name = 'x' WHERE id = :w",
            org_id=other.org_id,
            user_id=other.user_id,
            w=ctx.workflow_id,  # type: ignore[attr-defined]
        )
        == 0
    )


async def test_app_worker_cannot_modify_workflow_definitions(
    worker_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    for statement in (
        "UPDATE workflows SET name = 'x' WHERE id = :w",
        "UPDATE workflow_statuses SET name = 'x' WHERE id = :s",
        "DELETE FROM workflow_transitions WHERE id = :t",
        "INSERT INTO workflow_statuses (org_id, workflow_id, name, category, position) VALUES "
        "(:o, :w, 'Extra', 'todo', 99)",
    ):
        error = await denied(
            worker_engine,
            statement,
            org_id=seeded_project.org_id,
            user_id=seeded_project.user_id,
            w=ctx.workflow_id,  # type: ignore[attr-defined]
            s=ctx.status_id,  # type: ignore[attr-defined]
            t=ctx.transition_id,  # type: ignore[attr-defined]
            o=seeded_project.org_id,
        )
        assert "permission denied" in error.lower() or "row-level security" in error.lower()


async def test_owner_can_insert_and_delete_status_when_rls_allows(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    new_id = uuid.uuid4()
    params = {
        "id": new_id,
        "o": seeded_project.org_id,
        "w": ctx.workflow_id,  # type: ignore[attr-defined]
    }
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_tenant(
            session, TenantContext(org_id=seeded_project.org_id, user_id=seeded_project.user_id)
        )
        inserted = await session.execute(
            text(
                "INSERT INTO workflow_statuses (id, org_id, workflow_id, name, category, position) "
                "VALUES (:id, :o, :w, 'QA', 'in_progress', 50)"
            ),
            params,
        )
        deleted = await session.execute(
            text("DELETE FROM workflow_statuses WHERE id = :id"),
            {"id": new_id},
        )
        assert inserted.rowcount == 1  # type: ignore[attr-defined]
        assert deleted.rowcount == 1  # type: ignore[attr-defined]
        await session.rollback()


async def test_owner_can_delete_transition_when_rls_allows(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    assert (
        await affected(
            rw_engine,
            "DELETE FROM workflow_transitions WHERE id = :t",
            org_id=seeded_project.org_id,
            user_id=seeded_project.user_id,
            t=ctx.transition_id,  # type: ignore[attr-defined]
        )
        == 1
    )


async def test_status_delete_still_restricted_when_issues_reference_it(
    rw_engine: AsyncEngine, seeded_project: Tenant
) -> None:
    ctx = await _project_context(seeded_project.org_id, "WEB")
    types, priorities = await _config(seeded_project.org_id)
    async with AsyncExitStack() as stack:
        issue_ctx = Ctx(
            stack=stack, tenant=seeded_project, types=types, priorities=priorities
        )
        assert (await new_issue(issue_ctx.http, issue_ctx)).status_code == 201
    error = await denied(
        rw_engine,
        "DELETE FROM workflow_statuses WHERE id = :s",
        org_id=seeded_project.org_id,
        user_id=seeded_project.user_id,
        commit=True,
        s=ctx.status_id,  # type: ignore[attr-defined]
    )
    assert "violates foreign key constraint" in error or "RESTRICT" in error


async def test_workflow_get_response_unchanged_for_a4a(seeded_project: Tenant) -> None:
    base = f"/api/v1/orgs/{seeded_project.slug}/projects/WEB"
    workflow = (await seeded_project.http.get(f"{base}/workflow")).json()
    assert workflow["name"] == "Default workflow"
    assert len(workflow["statuses"]) == 4


async def test_revision_exposed_in_get_workflow(seeded_project: Tenant) -> None:
    base = f"/api/v1/orgs/{seeded_project.slug}/projects/WEB"
    workflow = (await seeded_project.http.get(f"{base}/workflow")).json()
    assert workflow["revision"] == 1
