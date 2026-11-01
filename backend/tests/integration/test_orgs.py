"""M3 organizations against real PostgreSQL/Redis (plan M3, V2.6, V2.9, V3.6, R3.1).

Database-level assertions run as the restricted runtime role (``app_rw``); the superuser
connection only prepares fixtures and inspects results.
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.db.tenant import TenantContext, bind_tenant
from app.modules.audit import service as audit_service
from app.modules.orgs.slugs import RESERVED_SLUGS
from tests.integration.auth_support import (
    auth_client,
    csrf,
    flush_test_redis,
    login,
    signup,
    superuser_sql,
    unique_email,
)
from tests.integration.tenancy_support import (
    Tenant,
    add_member,
    create_org,
    denied,
    make_tenant,
    unique_slug,
    verified_user,
)


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with auth_client() as client:
        await verified_user(client)
        yield client


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


async def org_state(slug: str) -> dict[str, int]:
    [row] = await superuser_sql(
        "SELECT (SELECT count(*) FROM organizations WHERE slug = :s) AS orgs, "
        "(SELECT count(*) FROM org_memberships m JOIN organizations o ON o.id = m.org_id "
        " WHERE o.slug = :s) AS members, "
        "(SELECT count(*) FROM issue_types t JOIN organizations o ON o.id = t.org_id "
        " WHERE o.slug = :s) AS types, "
        "(SELECT count(*) FROM priorities p JOIN organizations o ON o.id = p.org_id "
        " WHERE o.slug = :s) AS priorities, "
        "(SELECT count(*) FROM audit_events a JOIN organizations o ON o.id = a.org_id "
        " WHERE o.slug = :s) AS audits, "
        "(SELECT count(*) FROM organization_settings s JOIN organizations o ON o.id = s.org_id "
        " WHERE o.slug = :s) AS settings",
        s=slug,
    )
    return dict(row._mapping)


# ------------------------------------------------------------------------- creation
async def test_creation_writes_org_owner_seeds_and_audit_atomically(
    http: httpx.AsyncClient,
) -> None:
    slug = unique_slug()
    response = await create_org(http, slug, "  Acme Corp  ")
    assert response.status_code == 201
    assert response.json() == {"slug": slug, "name": "Acme Corp", "role": "owner"}
    assert response.headers["location"] == f"/api/v1/orgs/{slug}"
    assert await org_state(slug) == {
        "orgs": 1,
        "members": 1,
        "types": 5,
        "priorities": 5,
        "audits": 1,
        "settings": 1,
    }
    [settings] = await superuser_sql(
        "SELECT timezone, locale FROM organization_settings s "
        "JOIN organizations o ON o.id = s.org_id WHERE o.slug = :s",
        s=slug,
    )
    assert settings.timezone == "UTC"
    assert settings.locale == "en-US"
    [owner] = await superuser_sql(
        "SELECT m.role, m.can_create_projects, m.user_id = o.created_by AS is_creator, "
        "a.action, a.metadata::text AS md FROM org_memberships m "
        "JOIN organizations o ON o.id = m.org_id JOIN audit_events a ON a.org_id = o.id "
        "WHERE o.slug = :s",
        s=slug,
    )
    assert owner.role == "owner"
    assert owner.is_creator
    assert not owner.can_create_projects
    assert owner.action == "org.created"
    assert owner.md == f'{{"slug": "{slug}"}}'


async def test_seeded_configuration_is_exactly_the_approved_defaults(tenant: Tenant) -> None:
    types = (await tenant.http.get(f"/api/v1/orgs/{tenant.slug}/issue-types")).json()["items"]
    assert [(t["name"], t["kind"]) for t in types] == [
        ("Epic", "epic"),
        ("Story", "standard"),
        ("Task", "standard"),
        ("Bug", "standard"),
        ("Sub-task", "subtask"),
    ]
    priorities = (await tenant.http.get(f"/api/v1/orgs/{tenant.slug}/priorities")).json()
    assert [p["name"] for p in priorities["items"]] == [
        "Highest",
        "High",
        "Medium",
        "Low",
        "Lowest",
    ]


@pytest.mark.parametrize("failing_step", ["seed", "audit"])
async def test_any_failure_rolls_back_the_whole_creation(
    http: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch, failing_step: str
) -> None:
    slug = unique_slug()

    async def explode(*args: object, **kwargs: object) -> None:
        raise RuntimeError("injected failure")

    if failing_step == "audit":
        monkeypatch.setattr(audit_service, "record", explode)
    else:
        monkeypatch.setattr("app.modules.orgs.repository.PRIORITIES", (("Bad", "#zzzzzzzz"),))
    response = await create_org(http, slug)
    assert response.status_code == 500
    assert await org_state(slug) == {
        "orgs": 0,
        "members": 0,
        "types": 0,
        "priorities": 0,
        "audits": 0,
        "settings": 0,
    }


async def test_org_without_owner_is_rejected_at_commit_by_the_runtime_role(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    """The deferred trigger works under RLS as app_rw: the insert itself succeeds, the
    COMMIT fails, and nothing persists."""
    org_id, slug = uuid.uuid4(), unique_slug()
    error = await denied(
        rw_engine,
        "INSERT INTO organizations (id, slug, name, created_by) VALUES (:o, :s, 'X', :u)",
        org_id=org_id,
        user_id=tenant.user_id,
        commit=True,
        o=org_id,
        s=slug,
        u=tenant.user_id,
    )
    assert "organization must have an owner membership" in error
    assert await org_state(slug) == {
        "orgs": 0,
        "members": 0,
        "types": 0,
        "priorities": 0,
        "audits": 0,
        "settings": 0,
    }


async def test_org_with_only_a_non_owner_member_is_rejected_at_commit(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    org_id = uuid.uuid4()
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_tenant(session, TenantContext(org_id=org_id, user_id=tenant.user_id))
        await session.execute(
            text("INSERT INTO organizations (id, slug, name, created_by) VALUES (:o, :s, 'X', :u)"),
            {"o": org_id, "s": unique_slug(), "u": tenant.user_id},
        )
        # The creator cannot claim the first row as anything but owner (RLS).
        with pytest.raises(Exception, match="row-level security"):
            await session.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:o, :u, 'admin')"
                ),
                {"o": org_id, "u": tenant.user_id},
            )
        await session.rollback()


async def test_unverified_user_cannot_create_an_org() -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        await login(http, email)
        slug = unique_slug()
        response = await create_org(http, slug)
    assert response.status_code == 403
    assert response.json()["code"] == "email_unverified"
    assert (await org_state(slug))["orgs"] == 0


@pytest.mark.parametrize(
    ("slug", "status"),
    [
        ("a", 422),
        ("-acme", 422),
        ("acme_corp", 422),
        ("acme corp", 422),
        ("a" * 40, 422),
        (sorted(RESERVED_SLUGS)[0], 409),
        ("settings", 409),
        ("API", 409),
    ],
)
async def test_invalid_or_reserved_slugs_are_rejected(
    http: httpx.AsyncClient, slug: str, status: int
) -> None:
    response = await create_org(http, slug)
    assert response.status_code == status


async def test_duplicate_slugs_are_rejected_case_insensitively(
    tenant: Tenant, http: httpx.AsyncClient
) -> None:
    for variant in (tenant.slug, tenant.slug.upper()):
        response = await create_org(http, variant)
        assert response.status_code == 409
        assert response.json()["code"] == "slug_unavailable"


@pytest.mark.parametrize("name", ["", "   ", "x" * 101])
async def test_org_name_is_trimmed_and_bounded(http: httpx.AsyncClient, name: str) -> None:
    assert (await create_org(http, unique_slug(), name)).status_code == 422


@pytest.mark.parametrize("name", [" padded", "x" * 101, ""])
async def test_database_enforces_the_name_rule_for_the_runtime_role(
    rw_engine: AsyncEngine, tenant: Tenant, name: str
) -> None:
    error = await denied(
        rw_engine,
        "UPDATE organizations SET name = :n WHERE id = :o",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        n=name,
        o=tenant.org_id,
    )
    assert "ck_organizations_name_valid" in error or "value too long" in error


async def test_org_creation_is_limited_to_ten_attempts_per_hour(http: httpx.AsyncClient) -> None:
    """Every well-formed attempt counts, including rejected ones (here: a reserved slug).
    Requests that fail schema validation never reach the service and are not counted."""
    statuses = [(await create_org(http, "admin")).status_code for _ in range(10)]
    assert statuses == [409] * 10
    limited = await create_org(http, unique_slug())
    assert limited.status_code == 429
    assert "retry-after" in limited.headers


async def test_org_creation_limit_holds_with_redis_down() -> None:
    async with auth_client(redis_url="redis://127.0.0.1:1/0") as http:
        await verified_user(http)
        statuses = [(await create_org(http, "admin")).status_code for _ in range(10)]
        assert statuses == [409] * 10
        assert (await create_org(http, unique_slug())).status_code == 429


# ---------------------------------------------------------------------- view/rename
async def test_list_my_orgs_and_session_include_only_active_memberships(tenant: Tenant) -> None:
    listed = (await tenant.http.get("/api/v1/orgs")).json()["items"]
    assert listed == [{"slug": tenant.slug, "name": "Acme", "role": "owner"}]
    session = (await tenant.http.get("/api/v1/auth/session")).json()
    assert session["orgs"] == listed


async def test_rename_is_audited_and_slug_is_immutable(tenant: Tenant) -> None:
    path = f"/api/v1/orgs/{tenant.slug}"
    renamed = await tenant.http.patch(
        path, json={"name": " Acme 2 "}, headers=await tenant.headers()
    )
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Acme 2"
    immutable = await tenant.http.patch(
        path, json={"slug": "new-slug"}, headers=await tenant.headers()
    )
    assert immutable.status_code == 422
    assert immutable.json()["code"] == "field_immutable"
    [row] = await superuser_sql("SELECT slug FROM organizations WHERE id = :o", o=tenant.org_id)
    assert row.slug == tenant.slug
    actions = await superuser_sql(
        "SELECT action, metadata::text AS md FROM audit_events WHERE org_id = :o ORDER BY id",
        o=tenant.org_id,
    )
    assert [(a.action, a.md) for a in actions] == [
        ("org.created", f'{{"slug": "{tenant.slug}"}}'),
        ("org.updated", '{"fields": "name"}'),
    ]


async def test_slug_cannot_change_even_through_direct_sql_as_runtime_role(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    error = await denied(
        rw_engine,
        "UPDATE organizations SET slug = 'renamed' WHERE id = :o",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        o=tenant.org_id,
    )
    assert "permission denied" in error


async def test_rename_requires_csrf_and_manage_permission(tenant: Tenant) -> None:
    path = f"/api/v1/orgs/{tenant.slug}"
    assert (await tenant.http.patch(path, json={"name": "X"})).status_code == 403
    async with auth_client() as other:
        _, member_id = await verified_user(other)
        await add_member(tenant.org_id, member_id)
        token = await csrf(other)
        response = await other.patch(path, json={"name": "X"}, headers={"X-CSRF-Token": token})
        assert response.status_code == 403
        assert response.json()["code"] == "forbidden"


# ------------------------------------------------------------- membership escalation
async def member_of(tenant: Tenant, role: str) -> uuid.UUID:
    async with auth_client() as other:
        _, user_id = await verified_user(other)
    await add_member(tenant.org_id, user_id, role)
    return user_id


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE org_memberships SET role = 'owner' WHERE org_id = :o AND user_id = :me",
        "UPDATE org_memberships SET role = 'admin' WHERE org_id = :o AND user_id = :me",
        "UPDATE org_memberships SET can_create_projects = true WHERE org_id = :o AND user_id = :me",
        "UPDATE org_memberships SET removed_at = now() WHERE org_id = :o AND user_id = :owner",
    ],
)
async def test_members_cannot_change_any_membership(
    rw_engine: AsyncEngine, tenant: Tenant, statement: str
) -> None:
    me = await member_of(tenant, "member")
    async with AsyncSession(bind=rw_engine) as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=tenant.org_id, user_id=me))
        result = await session.execute(
            text(statement), {"o": tenant.org_id, "me": me, "owner": tenant.user_id}
        )
        assert result.rowcount == 0  # type: ignore[attr-defined]
    [row] = await superuser_sql(
        "SELECT role, can_create_projects FROM org_memberships WHERE org_id = :o AND user_id = :u",
        o=tenant.org_id,
        u=me,
    )
    assert (row.role, row.can_create_projects) == ("member", False)


@pytest.mark.parametrize("role", ["owner", "admin", "member"])
async def test_members_cannot_add_memberships(
    rw_engine: AsyncEngine, tenant: Tenant, role: str
) -> None:
    me = await member_of(tenant, "member")
    async with auth_client() as other:
        _, outsider = await verified_user(other)
    for target in (me, outsider):
        error = await denied(
            rw_engine,
            "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:o, :u, :r) "
            "ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role",
            org_id=tenant.org_id,
            user_id=me,
            o=tenant.org_id,
            u=target,
            r=role,
        )
        assert "row-level security" in error


async def test_admins_cannot_create_or_change_owner_rows(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    admin = await member_of(tenant, "admin")
    member = await member_of(tenant, "member")
    promoted = await denied(
        rw_engine,
        "UPDATE org_memberships SET role = 'owner' WHERE org_id = :o AND user_id = :u",
        org_id=tenant.org_id,
        user_id=admin,
        o=tenant.org_id,
        u=member,
    )
    assert "row-level security" in promoted
    demoting_owner = await rw_rowcount(
        rw_engine,
        "UPDATE org_memberships SET role = 'member' WHERE org_id = :o AND user_id = :u",
        tenant,
        admin,
        u=tenant.user_id,
    )
    assert demoting_owner == 0


async def rw_rowcount(
    engine: AsyncEngine, sql: str, tenant: Tenant, user_id: uuid.UUID, **params: object
) -> int:
    async with AsyncSession(bind=engine) as session:
        await session.begin()
        await bind_tenant(session, TenantContext(org_id=tenant.org_id, user_id=user_id))
        result = await session.execute(text(sql), {"o": tenant.org_id, **params})
        await session.rollback()
        return int(result.rowcount)  # type: ignore[attr-defined]


async def test_nobody_can_claim_the_initial_owner_row_of_an_existing_org(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    async with auth_client() as other:
        _, intruder = await verified_user(other)
    error = await denied(
        rw_engine,
        "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:o, :u, 'owner')",
        org_id=tenant.org_id,
        user_id=intruder,
        o=tenant.org_id,
        u=intruder,
    )
    assert "row-level security" in error


# ------------------------------------------------------------------- D9 Option B
async def permissions_of(http: httpx.AsyncClient, slug: str) -> list[str]:
    response = await http.get(f"/api/v1/orgs/{slug}")
    assert response.status_code == 200
    permissions: list[str] = response.json()["permissions"]
    return permissions


@pytest.mark.parametrize(
    ("role", "granted", "can_create"),
    [
        ("owner", False, True),
        ("admin", False, True),
        ("member", False, False),
        ("member", True, True),
    ],
)
async def test_project_creation_permission_follows_d9_option_b(
    tenant: Tenant, role: str, granted: bool, can_create: bool
) -> None:
    async with auth_client() as other:
        _, user_id = await verified_user(other)
        await superuser_sql(
            "INSERT INTO org_memberships (org_id, user_id, role, can_create_projects) "
            "VALUES (:o, :u, :r, :g)",
            o=tenant.org_id,
            u=user_id,
            r=role,
            g=granted,
        )
        assert ("project.create" in await permissions_of(other, tenant.slug)) is can_create


# --------------------------------------------------------------------- audit reads
async def test_audit_events_are_readable_by_owners_and_admins_only(tenant: Tenant) -> None:
    path = f"/api/v1/orgs/{tenant.slug}/audit-events"
    owner_view = await tenant.http.get(path)
    assert owner_view.status_code == 200
    [event] = owner_view.json()["items"]
    assert event["action"] == "org.created"
    assert event["actor_user_id"] == str(tenant.user_id)
    for role, expected in (("admin", 200), ("member", 403)):
        async with auth_client() as other:
            _, user_id = await verified_user(other)
            await add_member(tenant.org_id, user_id, role)
            assert (await other.get(path)).status_code == expected
    async with auth_client() as outsider:
        await verified_user(outsider)
        assert (await outsider.get(path)).status_code == 404


async def test_members_read_no_audit_rows_even_at_the_database_level(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    member = await member_of(tenant, "member")
    async with AsyncSession(bind=rw_engine) as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=tenant.org_id, user_id=member))
        count = (await session.execute(text("SELECT count(*) FROM audit_events"))).scalar_one()
    assert count == 0


@pytest.mark.parametrize(
    "statement",
    [
        "UPDATE audit_events SET action = 'x'",
        "DELETE FROM audit_events",
        "TRUNCATE audit_events",
    ],
)
async def test_audit_events_are_append_only_for_the_runtime_role(
    rw_engine: AsyncEngine, tenant: Tenant, statement: str
) -> None:
    error = await denied(rw_engine, statement, org_id=tenant.org_id, user_id=tenant.user_id)
    assert "permission denied" in error


async def test_audit_rows_cannot_be_forged_for_another_actor(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    other = await member_of(tenant, "member")
    error = await denied(
        rw_engine,
        "INSERT INTO audit_events (org_id, actor_user_id, action, outcome) "
        "VALUES (:o, :someone, 'org.updated', 'success')",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        o=tenant.org_id,
        someone=other,
    )
    assert "row-level security" in error


async def test_audit_pagination_and_filters(tenant: Tenant) -> None:
    for index in range(4):
        await tenant.http.patch(
            f"/api/v1/orgs/{tenant.slug}",
            json={"name": f"Acme {index}"},
            headers=await tenant.headers(),
        )
    path = f"/api/v1/orgs/{tenant.slug}/audit-events"
    first = (await tenant.http.get(path, params={"limit": 2})).json()
    second = (
        await tenant.http.get(path, params={"limit": 2, "cursor": first["next_cursor"]})
    ).json()
    third = (
        await tenant.http.get(path, params={"limit": 2, "cursor": second["next_cursor"]})
    ).json()
    ids = [e["id"] for page in (first, second, third) for e in page["items"]]
    assert len(ids) == 5
    assert ids == sorted(ids, reverse=True)
    assert third["next_cursor"] is None
    created = (await tenant.http.get(path, params={"action": "org.created"})).json()["items"]
    assert [e["action"] for e in created] == ["org.created"]
    by_actor = (await tenant.http.get(path, params={"actor": str(uuid.uuid4())})).json()
    assert by_actor["items"] == []
    bad = await tenant.http.get(path, params={"cursor": "not-a-cursor"})
    assert bad.status_code == 400
    assert bad.json()["code"] == "invalid_cursor"
    assert (await tenant.http.get(path, params={"limit": 101})).status_code == 422


def test_audit_metadata_is_allowlisted() -> None:
    with pytest.raises(ValueError, match="not allowlisted"):
        audit_service._validate("org.created", {"password": "x"})
    with pytest.raises(ValueError, match="unknown audit action"):
        audit_service._validate("org.deleted", {})


# ------------------------------------------------------------------------ outbox
async def test_outbox_accepts_only_platform_or_own_org_jobs_from_the_api_role(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    await flush_test_redis()
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
        error = await denied(
            rw_engine,
            "INSERT INTO outbox (org_id, topic, payload) VALUES (:b, 'email.verify', '{}')",
            org_id=tenant.org_id,
            user_id=tenant.user_id,
            b=other.org_id,
        )
        assert "row-level security" in error
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_tenant(session, TenantContext(org_id=tenant.org_id, user_id=tenant.user_id))
        await session.execute(
            text("INSERT INTO outbox (org_id, topic, payload) VALUES (:a, 'probe.tenant', '{}')"),
            {"a": tenant.org_id},
        )
        await session.execute(text("INSERT INTO outbox (topic, payload) VALUES ('probe', '{}')"))
        await session.rollback()
