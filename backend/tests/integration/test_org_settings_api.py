"""Organization settings HTTP API (A5.2)."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import pytest

from app.modules.audit import service as audit_service
from tests.integration.auth_support import auth_client, csrf, flush_test_redis, superuser_sql
from tests.integration.tenancy_support import Tenant, add_member, make_tenant, verified_user

SETTINGS = "/api/v1/orgs/{slug}/settings"


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


def path(slug: str) -> str:
    return SETTINGS.format(slug=slug)


async def audit_actions(org_id: object) -> list[tuple[str, str]]:
    rows = await superuser_sql(
        "SELECT action, metadata::text AS md FROM audit_events WHERE org_id = :o ORDER BY id",
        o=org_id,
    )
    return [(r.action, r.md) for r in rows]


async def test_unauthenticated_get_is_rejected() -> None:
    async with auth_client() as http:
        assert (await http.get(path("any-slug"))).status_code == 401


async def test_member_get_succeeds(tenant: Tenant) -> None:
    async with auth_client() as member_http:
        _, member_id = await verified_user(member_http)
        await add_member(tenant.org_id, member_id, "member")
        response = await member_http.get(path(tenant.slug))
    assert response.status_code == 200
    body = response.json()
    assert body["timezone"] == "UTC"
    assert body["locale"] == "en-US"
    assert body["story_points_enabled"] is True
    assert body["story_points_max"] == 100
    assert "updated_at" in body


async def test_owner_get_and_patch_succeed(tenant: Tenant) -> None:
    response = await tenant.http.get(path(tenant.slug))
    assert response.status_code == 200
    patched = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": "America/New_York", "locale": "en-CA"},
        headers=await tenant.headers(),
    )
    assert patched.status_code == 200
    assert patched.json()["timezone"] == "America/New_York"
    assert patched.json()["locale"] == "en-CA"


async def test_admin_patch_succeeds(tenant: Tenant) -> None:
    async with auth_client() as admin_http:
        _, admin_id = await verified_user(admin_http)
        await add_member(tenant.org_id, admin_id, "admin")
        token = await csrf(admin_http)
        response = await admin_http.patch(
            path(tenant.slug),
            json={"locale": "fr-FR"},
            headers={"X-CSRF-Token": token},
        )
    assert response.status_code == 200
    assert response.json()["locale"] == "fr-FR"


async def test_member_patch_forbidden(tenant: Tenant) -> None:
    async with auth_client() as member_http:
        _, member_id = await verified_user(member_http)
        await add_member(tenant.org_id, member_id, "member")
        token = await csrf(member_http)
        response = await member_http.patch(
            path(tenant.slug),
            json={"timezone": "Europe/Paris"},
            headers={"X-CSRF-Token": token},
        )
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"


async def test_cross_tenant_slug_returns_not_found(tenant: Tenant) -> None:
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, prefix="other-api")
        response = await tenant.http.get(path(other.slug))
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


async def test_patch_requires_csrf(tenant: Tenant) -> None:
    assert (await tenant.http.patch(path(tenant.slug), json={"timezone": "UTC"})).status_code == 403


async def test_invalid_timezone_rejected(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": "Not/A_Real_Zone"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 422


async def test_invalid_locale_rejected(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"locale": "en_US"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 422


async def test_valid_locale_with_script_and_extension(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"locale": "zh-hans-cn"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 200
    assert response.json()["locale"] == "zh-Hans-CN"


async def test_valid_private_use_locale(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"locale": "en-x-acme"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 200
    assert response.json()["locale"] == "en-x-acme"


async def test_explicit_null_rejected(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": None},
        headers=await tenant.headers(),
    )
    assert response.status_code == 422


async def test_empty_patch_rejected(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={},
        headers=await tenant.headers(),
    )
    assert response.status_code == 422


async def test_unknown_field_rejected(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": "UTC", "extra": "nope"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 422


async def test_partial_update_preserves_omitted_fields(tenant: Tenant) -> None:
    await tenant.http.patch(
        path(tenant.slug),
        json={"locale": "de-DE"},
        headers=await tenant.headers(),
    )
    only_tz = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": "Europe/Berlin"},
        headers=await tenant.headers(),
    )
    assert only_tz.status_code == 200
    assert only_tz.json()["timezone"] == "Europe/Berlin"
    assert only_tz.json()["locale"] == "de-DE"


async def test_no_op_patch_writes_no_audit(tenant: Tenant) -> None:
    before = await audit_actions(tenant.org_id)
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": "UTC", "locale": "en-US"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 200
    assert await audit_actions(tenant.org_id) == before


async def test_changed_patch_writes_one_audit_event(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": "Pacific/Auckland"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 200
    actions = await audit_actions(tenant.org_id)
    assert actions[-1] == ("org.settings.updated", '{"fields": "timezone"}')


async def test_owner_can_patch_story_points_settings(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"story_points_enabled": False, "story_points_max": 21},
        headers=await tenant.headers(),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["story_points_enabled"] is False
    assert body["story_points_max"] == 21


async def test_invalid_story_points_max_rejected(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"story_points_max": 0},
        headers=await tenant.headers(),
    )
    assert response.status_code == 422


async def test_story_points_change_writes_audit(tenant: Tenant) -> None:
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"story_points_max": 8},
        headers=await tenant.headers(),
    )
    assert response.status_code == 200
    actions = await audit_actions(tenant.org_id)
    assert actions[-1] == ("org.settings.updated", '{"fields": "story_points_max"}')


async def test_audit_and_update_roll_back_together(
    tenant: Tenant, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def explode(*args: object, **kwargs: object) -> None:
        raise RuntimeError("audit failed")

    monkeypatch.setattr(audit_service, "record", explode)
    response = await tenant.http.patch(
        path(tenant.slug),
        json={"timezone": "Asia/Tokyo"},
        headers=await tenant.headers(),
    )
    assert response.status_code == 500
    get = await tenant.http.get(path(tenant.slug))
    assert get.json()["timezone"] == "UTC"
