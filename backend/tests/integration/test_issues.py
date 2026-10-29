"""M6: issues core (plan M6, R3.3 rows 9-15, R4, R7-M6). Database-level assertions run as
the restricted runtime role unless they explicitly need the superuser (FK checks with RLS
bypassed, fixture setup)."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import AsyncExitStack, contextmanager
from dataclasses import dataclass
from typing import Any

import httpx
import pytest
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.modules.issues import repository
from app.modules.issues.repository import initial_rank
from tests.integration.auth_support import flush_test_redis, superuser_sql
from tests.integration.tenancy_support import (
    Tenant,
    affected,
    bound,
    denied,
    make_tenant,
    rows,
)
from tests.integration.test_projects import create_project, org_member, send


@dataclass
class Ctx:
    stack: AsyncExitStack
    tenant: Tenant
    types: dict[str, uuid.UUID]  # kind -> id ("standard" = Task)
    priorities: dict[str, uuid.UUID]  # name -> id

    @property
    def slug(self) -> str:
        return self.tenant.slug

    @property
    def http(self) -> httpx.AsyncClient:
        return self.tenant.http

    def body(self, summary: str = "Login button misaligned", **extra: object) -> dict[str, Any]:
        return {
            "type_id": str(self.types["standard"]),
            "priority_id": str(self.priorities["Medium"]),
            "summary": summary,
            **extra,
        }


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


async def _config(org_id: uuid.UUID) -> tuple[dict[str, uuid.UUID], dict[str, uuid.UUID]]:
    types = await superuser_sql(
        "SELECT DISTINCT ON (kind) id, kind FROM issue_types WHERE org_id = :o "
        "ORDER BY kind, name = 'Task' DESC",
        o=org_id,
    )
    priorities = await superuser_sql("SELECT id, name FROM priorities WHERE org_id = :o", o=org_id)
    return {t.kind: t.id for t in types}, {p.name: p.id for p in priorities}


@pytest.fixture
async def ctx() -> AsyncIterator[Ctx]:
    async with AsyncExitStack() as stack:
        tenant = await make_tenant(stack)
        assert (await create_project(tenant.http, tenant.slug)).status_code == 201
        types, priorities = await _config(tenant.org_id)
        yield Ctx(stack=stack, tenant=tenant, types=types, priorities=priorities)


async def new_issue(
    http: httpx.AsyncClient,
    ctx: Ctx,
    body: dict[str, Any] | None = None,
    project: str = "WEB",
    key: str | None = None,
) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else {}
    return await http.post(
        f"/api/v1/orgs/{ctx.slug}/projects/{project}/issues",
        json=body if body is not None else ctx.body(),
        headers={"X-CSRF-Token": await _csrf(http), **headers},
    )


async def _csrf(http: httpx.AsyncClient) -> str:
    return str((await http.get("/api/v1/auth/session")).json()["csrf_token"])


async def patch(
    http: httpx.AsyncClient, slug: str, key: str, body: object, if_match: str | None
) -> httpx.Response:
    headers = {"X-CSRF-Token": await _csrf(http)}
    if if_match is not None:
        headers["If-Match"] = if_match
    return await http.patch(f"/api/v1/orgs/{slug}/issues/{key}", json=body, headers=headers)


async def issue_row(org_id: uuid.UUID, seq: int, project: str = "WEB") -> Any:
    found = await superuser_sql(
        "SELECT i.* FROM issues i JOIN projects p ON p.id = i.project_id "
        "WHERE i.org_id = :o AND p.key = :k AND i.seq = :s",
        o=org_id,
        k=project,
        s=seq,
    )
    return found[0] if found else None


async def counter(org_id: uuid.UUID, project: str = "WEB") -> int:
    [row] = await superuser_sql(
        "SELECT c.next_seq FROM project_issue_counters c JOIN projects p ON p.id = c.project_id "
        "WHERE p.org_id = :o AND p.key = :k",
        o=org_id,
        k=project,
    )
    return int(row.next_seq)


async def activity(issue_id: uuid.UUID) -> list[Any]:
    return await superuser_sql(
        "SELECT action, field, actor_id, old_value, new_value FROM issue_activity "
        "WHERE issue_id = :i ORDER BY id",
        i=issue_id,
    )


async def project_role(ctx: Ctx, role: str) -> tuple[httpx.AsyncClient, uuid.UUID]:
    """An org member with the given project role on WEB."""
    http, user_id = await org_member(ctx.stack, ctx.tenant)
    response = await send(
        ctx.http,
        "POST",
        f"/api/v1/orgs/{ctx.slug}/projects/WEB/members",
        {"user_id": str(user_id), "role": role},
    )
    assert response.status_code == 204, response.text
    return http, user_id


# ----------------------------------------------------------------- create and read
async def test_create_get_and_created_activity(ctx: Ctx) -> None:
    response = await new_issue(ctx.http, ctx, ctx.body(description="Steps to reproduce"))
    assert response.status_code == 201, response.text
    issue = response.json()
    assert issue["key"] == "WEB-1"
    assert issue["version"] == 1
    assert issue["status"]["name"] == "To Do"
    assert issue["reporter"]["id"] == str(ctx.tenant.user_id)
    assert issue["assignee"] is None
    assert response.headers["ETag"] == '"v1"'
    assert response.headers["Location"] == f"/api/v1/orgs/{ctx.slug}/issues/WEB-1"

    fetched = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/web-1")
    assert fetched.status_code == 200
    assert fetched.json() == issue
    assert fetched.headers["ETag"] == '"v1"'
    [created] = await activity(uuid.UUID(issue["id"]))
    assert created.action == "created"
    assert created.actor_id == ctx.tenant.user_id
    history = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1/activity")
    assert [a["action"] for a in history.json()["items"]] == ["created"]


async def test_fifty_concurrent_creates_get_unique_gap_free_keys(ctx: Ctx) -> None:
    responses = await asyncio.gather(
        *(new_issue(ctx.http, ctx, ctx.body(f"Issue {n}")) for n in range(50))
    )
    assert [r.status_code for r in responses] == [201] * 50
    assert sorted(int(r.json()["key"].split("-")[1]) for r in responses) == list(range(1, 51))
    assert await counter(ctx.tenant.org_id) == 50


async def test_failed_creates_do_not_consume_numbers(
    ctx: Ctx, monkeypatch: pytest.MonkeyPatch
) -> None:
    bad_type = await new_issue(ctx.http, ctx, ctx.body(type_id=str(uuid.uuid4())))
    assert bad_type.status_code == 422
    assert bad_type.json()["code"] == "invalid_type"
    subtask = await new_issue(ctx.http, ctx, ctx.body(type_id=str(ctx.types["subtask"])))
    assert subtask.status_code == 422
    assert subtask.json()["code"] == "subtask_requires_parent"

    async def fail(*_: object, **__: object) -> None:  # after allocation and insert
        raise RuntimeError("injected failure")

    monkeypatch.setattr(repository, "add_activity", fail)
    assert (await new_issue(ctx.http, ctx)).status_code == 500
    monkeypatch.undo()
    assert await superuser_sql("SELECT id FROM issues WHERE org_id = :o", o=ctx.tenant.org_id) == []
    assert await counter(ctx.tenant.org_id) == 0
    assert (await new_issue(ctx.http, ctx)).json()["key"] == "WEB-1"


async def test_server_owned_fields_are_rejected(ctx: Ctx) -> None:
    """Status is server-owned on create/update (set only through the transitions
    endpoints, M7); assignee/parent are legitimate M7 fields, exercised separately."""
    for extra in (
        {"key": "WEB-99"},
        {"reporter_id": str(uuid.uuid4())},
        {"status_id": str(uuid.uuid4())},
        {"version": 7},
        {"org_id": str(uuid.uuid4())},
        {"parent_key": "WEB-1"},  # unknown field; the real one is parent_id
        {"rank": "0"},
    ):
        response = await new_issue(ctx.http, ctx, ctx.body(**extra))
        assert response.status_code == 422, extra
    assert (await new_issue(ctx.http, ctx)).status_code == 201
    for field in ("status_id", "version", "reporter_id", "key"):
        response = await patch(ctx.http, ctx.slug, "WEB-1", {field: None}, '"v1"')
        assert response.status_code == 422, field
    row = await issue_row(ctx.tenant.org_id, 1)
    assert row.version == 1
    assert row.reporter_id == ctx.tenant.user_id


async def test_archived_projects_reject_issue_writes(ctx: Ctx) -> None:
    assert (await new_issue(ctx.http, ctx)).status_code == 201
    await send(ctx.http, "POST", f"/api/v1/orgs/{ctx.slug}/projects/WEB/archive")
    assert (await new_issue(ctx.http, ctx)).status_code == 409
    response = await patch(ctx.http, ctx.slug, "WEB-1", {"summary": "x"}, '"v1"')
    assert response.json()["code"] == "project_archived"
    assert (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1")).status_code == 200


# ------------------------------------------------------------------- idempotency
async def test_idempotent_create_replays_and_binds_key_to_request(ctx: Ctx) -> None:
    first = await new_issue(ctx.http, ctx, key="retry-1")
    again = await new_issue(ctx.http, ctx, key="retry-1")
    assert first.status_code == again.status_code == 201
    assert again.json() == first.json()
    assert again.headers["ETag"] == first.headers["ETag"]
    reused = await new_issue(ctx.http, ctx, ctx.body("Different"), key="retry-1")
    assert reused.status_code == 422
    assert reused.json()["code"] == "idempotency_key_reused"
    elsewhere = await create_project(ctx.http, ctx.slug, key="APP")
    assert elsewhere.status_code == 201
    other_project = await new_issue(ctx.http, ctx, project="APP", key="retry-1")
    assert other_project.json()["code"] == "idempotency_key_reused"  # bound to the request

    colleague, _ = await project_role(ctx, "member")  # same key, other user: independent
    theirs = await new_issue(colleague, ctx, key="retry-1")
    assert theirs.status_code == 201
    assert theirs.json()["key"] == "WEB-2"
    assert await counter(ctx.tenant.org_id) == 2
    assert (await new_issue(ctx.http, ctx, key="bad key!")).status_code == 422


async def test_concurrent_identical_idempotent_creates_make_one_issue(ctx: Ctx) -> None:
    responses = await asyncio.gather(*(new_issue(ctx.http, ctx, key="race") for _ in range(4)))
    assert {r.status_code for r in responses} == {201}
    assert len({json.dumps(r.json(), sort_keys=True) for r in responses}) == 1
    assert await counter(ctx.tenant.org_id) == 1


async def test_replay_after_access_is_revoked_discloses_nothing(ctx: Ctx) -> None:
    member, member_id = await project_role(ctx, "member")
    assert (await new_issue(member, ctx, key="k1")).status_code == 201
    await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/projects/WEB/members/{member_id}")
    replay = await new_issue(member, ctx, key="k1")
    assert replay.status_code == 404
    assert replay.json()["code"] == "not_found"


# ------------------------------------------------------------- update and version
async def test_update_requires_if_match_and_rejects_stale_versions(ctx: Ctx) -> None:
    issue = (await new_issue(ctx.http, ctx)).json()
    issue_id = uuid.UUID(issue["id"])
    missing = await patch(ctx.http, ctx.slug, "WEB-1", {"summary": "New"}, None)
    assert missing.status_code == 428
    assert missing.json()["code"] == "precondition_required"
    for stale in ('"v2"', '"v0"', "v1", "*"):
        response = await patch(ctx.http, ctx.slug, "WEB-1", {"summary": "New"}, stale)
        assert response.status_code == 412, stale
    assert (await issue_row(ctx.tenant.org_id, 1)).summary == issue["summary"]
    assert len(await activity(issue_id)) == 1

    body = {"summary": "New", "priority_id": str(ctx.priorities["High"]), "description": "D"}
    updated = await patch(ctx.http, ctx.slug, "WEB-1", body, '"v1"')
    assert updated.status_code == 200, updated.text
    assert updated.headers["ETag"] == '"v2"'
    assert updated.json()["priority"]["name"] == "High"
    changes = (await activity(issue_id))[1:]
    assert sorted(c.field for c in changes) == ["description", "priority", "summary"]
    assert {c.action for c in changes} == {"updated"}
    priority = next(c for c in changes if c.field == "priority")
    assert priority.old_value["name"] == "Medium"
    assert priority.new_value["name"] == "High"

    unchanged = await patch(ctx.http, ctx.slug, "WEB-1", {"summary": "New"}, '"v2"')
    assert unchanged.json()["version"] == 2  # no change, no bump, no activity
    assert len(await activity(issue_id)) == 4
    epic = await patch(ctx.http, ctx.slug, "WEB-1", {"type_id": str(ctx.types["epic"])}, '"v2"')
    assert epic.json()["type"]["kind"] == "epic"
    subtask = {"type_id": str(ctx.types["subtask"])}
    assert (await patch(ctx.http, ctx.slug, "WEB-1", subtask, '"v3"')).status_code == 422
    assert (await patch(ctx.http, ctx.slug, "WEB-1", {}, '"v3"')).status_code == 422


async def test_concurrent_updates_with_the_same_version_one_wins(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx)
    responses = await asyncio.gather(
        *(patch(ctx.http, ctx.slug, "WEB-1", {"summary": f"S{n}"}, '"v1"') for n in range(3))
    )
    assert sorted(r.status_code for r in responses) == [200, 412, 412]
    assert (await issue_row(ctx.tenant.org_id, 1)).version == 2


async def test_rank_updates_do_not_bump_the_version(ctx: Ctx, rw_engine: AsyncEngine) -> None:
    await new_issue(ctx.http, ctx)
    await new_issue(ctx.http, ctx)
    first, second = await issue_row(ctx.tenant.org_id, 1), await issue_row(ctx.tenant.org_id, 2)
    assert (first.rank, second.rank) == (initial_rank(1), initial_rank(2)) == ("000001", "000002")
    async with bound(rw_engine, org_id=ctx.tenant.org_id, user_id=ctx.tenant.user_id) as session:
        assert await repository.set_rank(session, first.id, "000003")
        await session.commit()
    moved = await issue_row(ctx.tenant.org_id, 1)
    assert moved.rank == "000003"
    assert moved.version == 1
    updated = await patch(ctx.http, ctx.slug, "WEB-1", {"summary": "Still fine"}, '"v1"')
    assert updated.status_code == 200  # an open edit is not invalidated by a reorder


def test_interim_ranks_sort_in_creation_order_under_c_collation() -> None:
    keys = [initial_rank(n) for n in (1, 9, 10, 35, 36, 61, 62, 3843, 3844, 10**9)]
    assert keys == sorted(keys)  # Python str ordering = byte ordering = COLLATE "C"
    assert all(len(k) == 6 for k in keys)


# ------------------------------------------------------- visibility and permissions
def fingerprint(response: httpx.Response) -> tuple[int, str]:
    payload = response.json()
    payload.pop("request_id", None)
    return response.status_code, json.dumps(payload, sort_keys=True)


async def test_org_membership_alone_grants_no_access_to_project_issues(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx)
    outsider, _ = await org_member(ctx.stack, ctx.tenant)  # org member, no project role
    unknown = await outsider.get(f"/api/v1/orgs/{ctx.slug}/issues/NOPE-1")
    missing = await outsider.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-99")
    malformed = await outsider.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-0")
    expected = fingerprint(unknown)
    assert expected[0] == 404
    for response in (
        missing,
        malformed,
        await outsider.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1"),
        await outsider.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1/activity"),
        await patch(outsider, ctx.slug, "WEB-1", {"summary": "x"}, '"v1"'),
        await send(outsider, "DELETE", f"/api/v1/orgs/{ctx.slug}/issues/WEB-1"),
        await new_issue(outsider, ctx),
    ):
        assert fingerprint(response) == expected
    listing = await outsider.get(f"/api/v1/orgs/{ctx.slug}/issues")
    assert listing.json()["items"] == []
    assert (await outsider.get(f"/api/v1/orgs/{ctx.slug}/issues?project=WEB")).json()["items"] == []
    assert (await issue_row(ctx.tenant.org_id, 1)).version == 1


async def test_project_roles_govern_issue_actions(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx)
    viewer, _ = await project_role(ctx, "viewer")
    member, _ = await project_role(ctx, "member")
    assert (await viewer.get(f"/api/v1/orgs/{ctx.slug}/issues/WEB-1")).status_code == 200
    assert len((await viewer.get(f"/api/v1/orgs/{ctx.slug}/issues")).json()["items"]) == 1
    assert (await new_issue(viewer, ctx)).status_code == 403
    assert (await patch(viewer, ctx.slug, "WEB-1", {"summary": "x"}, '"v1"')).status_code == 403
    assert (
        await send(viewer, "DELETE", f"/api/v1/orgs/{ctx.slug}/issues/WEB-1")
    ).status_code == 403
    assert (await new_issue(member, ctx)).status_code == 201
    assert (await patch(member, ctx.slug, "WEB-1", {"summary": "x"}, '"v1"')).status_code == 200
    assert (
        await send(member, "DELETE", f"/api/v1/orgs/{ctx.slug}/issues/WEB-1")
    ).status_code == 403


async def test_rls_hides_issues_of_projects_the_caller_cannot_view(
    ctx: Ctx, rw_engine: AsyncEngine
) -> None:
    """Even if a service forgot the visibility check, the database returns nothing."""
    await new_issue(ctx.http, ctx)
    issue = await issue_row(ctx.tenant.org_id, 1)
    _, outsider_id = await org_member(ctx.stack, ctx.tenant)
    _, viewer_id = await project_role(ctx, "viewer")
    org = ctx.tenant.org_id
    sql = "SELECT id FROM issues"
    assert await rows(rw_engine, sql, org_id=org, user_id=outsider_id) == []
    assert len(await rows(rw_engine, sql, org_id=org, user_id=viewer_id)) == 1
    assert (
        await rows(rw_engine, "SELECT id FROM issue_activity", org_id=org, user_id=outsider_id)
        == []
    )
    for user_id in (outsider_id, viewer_id):
        changed = await affected(
            rw_engine,
            "UPDATE issues SET summary = 'pwned' WHERE id = :i",
            org_id=org,
            user_id=user_id,
            i=issue.id,
        )
        assert changed == 0


# --------------------------------------------------------- list, filters, pagination
@contextmanager
def statement_counter() -> Iterator[list[str]]:
    statements: list[str] = []

    def count(*args: Any) -> None:
        statements.append(args[2])

    event.listen(Engine, "before_cursor_execute", count)
    try:
        yield statements
    finally:
        event.remove(Engine, "before_cursor_execute", count)


async def test_list_filters_combine_and_paginate_stably(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    await new_issue(ctx.http, ctx, ctx.body("Bug one", type_id=str(ctx.types["epic"])))
    await new_issue(ctx.http, ctx, ctx.body("High one", priority_id=str(ctx.priorities["High"])))
    await new_issue(ctx.http, ctx, ctx.body("Plain"))
    await new_issue(ctx.http, ctx, ctx.body("Other project"), project="APP")
    base = f"/api/v1/orgs/{ctx.slug}/issues"

    async def keys(query: str) -> list[str]:
        response = await ctx.http.get(f"{base}?{query}")
        assert response.status_code == 200, response.text
        return [i["key"] for i in response.json()["items"]]

    assert await keys("sort=created_at") == ["WEB-1", "WEB-2", "WEB-3", "APP-1"]
    assert await keys("project=web&sort=created_at") == ["WEB-1", "WEB-2", "WEB-3"]
    assert await keys(f"type={ctx.types['epic']}") == ["WEB-1"]
    assert await keys(f"priority={ctx.priorities['High']}&project=WEB") == ["WEB-2"]
    assert await keys(f"priority={ctx.priorities['High']}&project=APP") == []
    assert len(await keys("status_category=todo")) == 4
    assert await keys("status_category=done") == []
    assert len(await keys("assignee=none")) == 4
    assert await keys("assignee=me") == []
    assert await keys("project=NOPE") == []
    assert (await ctx.http.get(f"{base}?assignee=bogus")).status_code == 422
    assert (await ctx.http.get(f"{base}?sort=summary")).status_code == 422
    assert (await ctx.http.get(f"{base}?limit=101")).status_code == 422

    seen: list[str] = []
    page = await ctx.http.get(f"{base}?limit=3&sort=-created_at")
    seen += [i["key"] for i in page.json()["items"]]
    cursor = page.json()["next_cursor"]
    await new_issue(ctx.http, ctx, ctx.body("Inserted between pages"))
    page = await ctx.http.get(f"{base}?limit=3&sort=-created_at&cursor={cursor}")
    seen += [i["key"] for i in page.json()["items"]]
    assert page.json()["next_cursor"] is None
    assert seen == ["APP-1", "WEB-3", "WEB-2", "WEB-1"]  # stable: no skips, no repeats
    wrong_sort = await ctx.http.get(f"{base}?sort=created_at&cursor={cursor}")
    assert wrong_sort.status_code == 400
    assert wrong_sort.json()["code"] == "invalid_cursor"
    assert (await ctx.http.get(f"{base}?cursor=garbage")).status_code == 400


async def test_list_query_count_does_not_grow_with_results(ctx: Ctx) -> None:
    member, _ = await project_role(ctx, "member")
    for n in range(3):
        await new_issue(member, ctx, ctx.body(f"I{n}"))
    with statement_counter() as small:
        assert len((await member.get(f"/api/v1/orgs/{ctx.slug}/issues")).json()["items"]) == 3
    for n in range(12):
        await new_issue(ctx.http if n % 2 else member, ctx, ctx.body(f"J{n}"))
    with statement_counter() as large:
        assert len((await member.get(f"/api/v1/orgs/{ctx.slug}/issues")).json()["items"]) == 15
    assert len(large) == len(small)
    assert len(large) <= 12, large


# --------------------------------------------------------- delete and member removal
async def test_soft_delete_by_project_admin_is_audited(ctx: Ctx) -> None:
    await new_issue(ctx.http, ctx)
    path = f"/api/v1/orgs/{ctx.slug}/issues/WEB-1"
    assert (await send(ctx.http, "DELETE", path)).status_code == 204
    assert (await ctx.http.get(path)).status_code == 404
    assert (await send(ctx.http, "DELETE", path)).status_code == 404
    assert (await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues")).json()["items"] == []
    row = await issue_row(ctx.tenant.org_id, 1)
    assert row.deleted_at is not None
    assert row.version == 2
    assert [a.action for a in await activity(row.id)] == ["created", "deleted"]
    [audit] = await superuser_sql(
        "SELECT actor_user_id, metadata FROM audit_events WHERE org_id = :o "
        "AND action = 'issue.deleted'",
        o=ctx.tenant.org_id,
    )
    assert audit.actor_user_id == ctx.tenant.user_id
    assert audit.metadata == {"key": "WEB-1"}
    assert (await new_issue(ctx.http, ctx)).json()["key"] == "WEB-2"  # numbers never reused


async def test_removing_an_org_member_unassigns_their_issues(ctx: Ctx) -> None:
    _, member_id = await project_role(ctx, "member")
    await new_issue(ctx.http, ctx)
    await new_issue(ctx.http, ctx)
    await superuser_sql(
        "UPDATE issues SET assignee_id = :u WHERE org_id = :o", u=member_id, o=ctx.tenant.org_id
    )
    response = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/members/{member_id}")
    assert response.status_code == 204, response.text
    for seq in (1, 2):
        row = await issue_row(ctx.tenant.org_id, seq)
        assert row.assignee_id is None
        assert row.version == 2
        last = (await activity(row.id))[-1]
        assert (last.field, last.actor_id, last.new_value) == ("assignee", ctx.tenant.user_id, None)
        assert last.old_value == {"id": str(member_id)}


# ------------------------------------------------------------ database guarantees
@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE issue_activity SET action = 'forged'",
        "DELETE FROM issue_activity",
        "DELETE FROM issues",
        "UPDATE issues SET reporter_id = :me",
        "UPDATE issues SET seq = 99",
        "UPDATE issues SET org_id = gen_random_uuid()",
        "DELETE FROM idempotency_keys",
    ],
)
async def test_runtime_role_cannot_rewrite_history_or_server_fields(
    ctx: Ctx, rw_engine: AsyncEngine, statement: str
) -> None:
    await new_issue(ctx.http, ctx, key="k")
    error = await denied(
        rw_engine,
        statement,
        org_id=ctx.tenant.org_id,
        user_id=ctx.tenant.user_id,
        me=ctx.tenant.user_id,
    )
    assert "permission denied" in error


async def test_composite_foreign_keys_reject_cross_tenant_and_cross_workflow_references(
    ctx: Ctx,
) -> None:
    """As superuser (RLS bypassed): only the composite FKs stand between the tables."""
    await new_issue(ctx.http, ctx)
    issue = await issue_row(ctx.tenant.org_id, 1)
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
        types, priorities = await _config(other.org_id)
        assert (await create_project(other.http, other.slug, key="OTH")).status_code == 201
        [other_status] = await superuser_sql(
            "SELECT s.id FROM workflow_statuses s JOIN projects p ON p.workflow_id = s.workflow_id "
            "WHERE p.org_id = :o LIMIT 1",
            o=other.org_id,
        )
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    [sibling_status] = await superuser_sql(
        "SELECT s.id FROM workflow_statuses s JOIN projects p ON p.workflow_id = s.workflow_id "
        "WHERE p.org_id = :o AND p.key = 'APP' LIMIT 1",
        o=ctx.tenant.org_id,
    )
    for column, value in (
        ("type_id", types["standard"]),
        ("priority_id", priorities["Medium"]),
        ("status_id", other_status.id),
        ("status_id", sibling_status.id),  # same tenant, another project's workflow
        ("reporter_id", other.user_id),
        ("assignee_id", other.user_id),
    ):
        with pytest.raises(DBAPIError, match="violates foreign key constraint"):
            await superuser_sql(
                f"UPDATE issues SET {column} = :v WHERE id = :i",  # noqa: S608 - fixed list
                v=value,
                i=issue.id,
            )
    with pytest.raises(DBAPIError, match="violates foreign key constraint"):
        await superuser_sql(
            "INSERT INTO issue_activity (org_id, issue_id, action) VALUES (:o, :i, 'created')",
            o=other.org_id,
            i=issue.id,
        )
