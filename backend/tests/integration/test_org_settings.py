"""Organization settings table, RLS and creation integration (A5.1)."""

import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.db.tenant import TenantContext, bind_tenant
from app.modules.orgs import repository
from app.modules.orgs.settings_defaults import DEFAULT_ORG_LOCALE, DEFAULT_ORG_TIMEZONE
from tests.integration.auth_support import auth_client, signup, superuser_sql, unique_email
from tests.integration.tenancy_support import (
    Tenant,
    add_member,
    affected,
    create_org,
    denied,
    make_tenant,
    rows,
    unique_slug,
    verified_user,
)


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


async def _settings_count_for_slug(slug: str) -> int:
    [row] = await superuser_sql(
        "SELECT count(*) AS n FROM organization_settings s "
        "JOIN organizations o ON o.id = s.org_id WHERE o.slug = :s",
        s=slug,
    )
    return int(row.n)


async def _settings_for_org(org_id: uuid.UUID) -> tuple[str, str]:
    [row] = await superuser_sql(
        "SELECT timezone, locale FROM organization_settings WHERE org_id = :o",
        o=org_id,
    )
    return row.timezone, row.locale


async def test_every_organization_has_one_settings_row_with_defaults(tenant: Tenant) -> None:
    [counts] = await superuser_sql(
        "SELECT (SELECT count(*) FROM organizations) AS orgs, "
        "(SELECT count(*) FROM organization_settings) AS settings"
    )
    assert counts.orgs >= 1
    assert counts.settings == counts.orgs
    tz, loc = await _settings_for_org(tenant.org_id)
    assert tz == DEFAULT_ORG_TIMEZONE
    assert loc == DEFAULT_ORG_LOCALE


async def test_new_org_creation_inserts_settings_atomically() -> None:
    async with auth_client() as http:
        await verified_user(http)
        slug = unique_slug()
        response = await create_org(http, slug)
        assert response.status_code == 201
    assert await _settings_count_for_slug(slug) == 1
    [row] = await superuser_sql(
        "SELECT timezone, locale FROM organization_settings s "
        "JOIN organizations o ON o.id = s.org_id WHERE o.slug = :s",
        s=slug,
    )
    assert row.timezone == DEFAULT_ORG_TIMEZONE
    assert row.locale == DEFAULT_ORG_LOCALE


async def test_settings_insert_rolls_back_when_creation_transaction_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    slug = unique_slug()

    async def explode(*args: object, **kwargs: object) -> None:
        raise RuntimeError("settings seed failed")

    monkeypatch.setattr(repository, "seed_organization_settings", explode)
    async with auth_client() as http:
        await verified_user(http)
        response = await create_org(http, slug)
    assert response.status_code == 500
    assert await _settings_count_for_slug(slug) == 0
    [row] = await superuser_sql("SELECT count(*) AS n FROM organizations WHERE slug = :s", s=slug)
    assert row.n == 0


async def test_create_org_with_owner_inserts_settings_as_app_rw(rw_engine: AsyncEngine) -> None:
    """Owner membership exists before settings INSERT; app_rw passes RLS without bypass."""
    org_id = uuid.uuid4()
    slug = unique_slug()
    async with auth_client() as http:
        _, owner_id = await verified_user(http)
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_tenant(session, TenantContext(org_id=org_id, user_id=owner_id))
        await repository.create_org_with_owner(
            session, org_id=org_id, slug=slug, name="RLS Seed Co", owner_id=owner_id
        )
        await session.commit()
    tz, loc = await _settings_for_org(org_id)
    assert tz == DEFAULT_ORG_TIMEZONE
    assert loc == DEFAULT_ORG_LOCALE


async def test_member_can_select_own_org_settings(rw_engine: AsyncEngine, tenant: Tenant) -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        [row] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
        await add_member(tenant.org_id, row.id, "member")
    result = await rows(
        rw_engine,
        "SELECT timezone, locale FROM organization_settings WHERE org_id = :o",
        org_id=tenant.org_id,
        user_id=row.id,
        o=tenant.org_id,
    )
    assert len(result) == 1
    assert result[0].timezone == DEFAULT_ORG_TIMEZONE


async def test_member_cannot_update_settings(rw_engine: AsyncEngine, tenant: Tenant) -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        [row] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
        await add_member(tenant.org_id, row.id, "member")
    changed = await affected(
        rw_engine,
        "UPDATE organization_settings SET timezone = 'Europe/Paris' WHERE org_id = :o",
        org_id=tenant.org_id,
        user_id=row.id,
        o=tenant.org_id,
    )
    assert changed == 0
    tz, _ = await _settings_for_org(tenant.org_id)
    assert tz == DEFAULT_ORG_TIMEZONE


async def test_owner_can_update_settings(rw_engine: AsyncEngine, tenant: Tenant) -> None:
    updated = await rows(
        rw_engine,
        "UPDATE organization_settings SET timezone = 'America/New_York', "
        "locale = 'en-CA', updated_at = now() WHERE org_id = :o RETURNING timezone, locale",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        o=tenant.org_id,
    )
    assert updated[0].timezone == "America/New_York"
    assert updated[0].locale == "en-CA"


async def test_admin_can_update_settings(rw_engine: AsyncEngine, tenant: Tenant) -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        [row] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
        await add_member(tenant.org_id, row.id, "admin")
    updated = await rows(
        rw_engine,
        "UPDATE organization_settings SET timezone = 'Europe/Berlin' WHERE org_id = :o "
        "RETURNING timezone",
        org_id=tenant.org_id,
        user_id=row.id,
        o=tenant.org_id,
    )
    assert updated[0].timezone == "Europe/Berlin"


async def test_member_cannot_read_other_org_settings(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, prefix="other")
        async with auth_client() as http:
            email = unique_email()
            await signup(http, email)
            [row] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
            await add_member(tenant.org_id, row.id, "member")
        visible = await rows(
            rw_engine,
            "SELECT org_id FROM organization_settings",
            org_id=tenant.org_id,
            user_id=row.id,
        )
        assert len(visible) == 1
        assert visible[0].org_id == tenant.org_id
        assert visible[0].org_id != other.org_id


async def test_app_worker_cannot_modify_settings(
    worker_engine: AsyncEngine, tenant: Tenant
) -> None:
    for statement in (
        "UPDATE organization_settings SET timezone = 'UTC' WHERE org_id = :o",
        "INSERT INTO organization_settings (org_id, timezone, locale) VALUES (:o, 'UTC', 'en-US')",
        "DELETE FROM organization_settings WHERE org_id = :o",
    ):
        error = await denied(
            worker_engine,
            statement,
            org_id=tenant.org_id,
            user_id=tenant.user_id,
            o=tenant.org_id,
        )
        assert "permission denied" in error.lower() or "row-level security" in error.lower()


async def test_app_rw_cannot_delete_settings(rw_engine: AsyncEngine, tenant: Tenant) -> None:
    error = await denied(
        rw_engine,
        "DELETE FROM organization_settings WHERE org_id = :o",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        o=tenant.org_id,
    )
    assert "permission denied" in error.lower()
