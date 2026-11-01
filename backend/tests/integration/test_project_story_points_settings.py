"""Project story points settings overrides (B2)."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import httpx
import pytest

from tests.integration.auth_support import auth_client, csrf, flush_test_redis, superuser_sql
from tests.integration.tenancy_support import Tenant, add_member, make_tenant, verified_user


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


def settings_path(slug: str, key: str = "WEB") -> str:
    return f"/api/v1/orgs/{slug}/projects/{key}/settings"


def org_settings_path(slug: str) -> str:
    return f"/api/v1/orgs/{slug}/settings"


async def create_project(http: httpx.AsyncClient, slug: str, key: str = "WEB") -> None:
    response = await http.post(
        f"/api/v1/orgs/{slug}/projects",
        json={"key": key, "name": "Website"},
        headers={"X-CSRF-Token": await csrf(http)},
    )
    assert response.status_code == 201, response.text


async def patch_settings(
    http: httpx.AsyncClient, slug: str, body: dict[str, object], key: str = "WEB"
) -> httpx.Response:
    return await http.patch(
        settings_path(slug, key),
        json=body,
        headers={"X-CSRF-Token": await csrf(http)},
    )


async def settings_row_count(project_id: object) -> int:
    [row] = await superuser_sql(
        "SELECT count(*) AS n FROM project_settings WHERE project_id = :p",
        p=project_id,
    )
    return int(row.n)


async def project_id_for(org_id: object, key: str) -> object:
    [row] = await superuser_sql(
        "SELECT id FROM projects WHERE org_id = :o AND key = :k",
        o=org_id,
        k=key,
    )
    return row.id


async def audit_actions(org_id: object) -> list[tuple[str, str]]:
    rows = await superuser_sql(
        "SELECT action, metadata::text AS md FROM audit_events WHERE org_id = :o ORDER BY id",
        o=org_id,
    )
    return [(r.action, r.md) for r in rows]


async def settings_updated_audit_count(org_id: object) -> int:
    [row] = await superuser_sql(
        "SELECT count(*) AS n FROM audit_events WHERE org_id = :o "
        "AND action = 'project.settings.updated'",
        o=org_id,
    )
    return int(row.n)


async def stored_overrides(project_id: object) -> tuple[bool | None, int | None]:
    rows = await superuser_sql(
        "SELECT story_points_enabled_override AS e, story_points_max_override AS m "
        "FROM project_settings WHERE project_id = :p",
        p=project_id,
    )
    if not rows:
        return None, None
    return rows[0].e, rows[0].m


async def test_default_settings_inherit_from_organization(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    response = await tenant.http.get(settings_path(tenant.slug))
    assert response.status_code == 200
    body = response.json()
    assert body["organization"] == {"story_points_enabled": True, "story_points_max": 100}
    assert body["overrides"] == {"story_points_enabled": None, "story_points_max": None}
    assert body["effective"] == {"story_points_enabled": True, "story_points_max": 100}
    assert body["provenance"] == {
        "story_points_enabled": "organization",
        "story_points_max": "organization",
    }
    assert body["updated_at"] is None
    pid = await project_id_for(tenant.org_id, "WEB")
    assert await settings_row_count(pid) == 0


async def test_project_admin_can_set_and_reset_overrides(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    pid = await project_id_for(tenant.org_id, "WEB")
    response = await patch_settings(
        tenant.http,
        tenant.slug,
        {"story_points_enabled_override": False, "story_points_max_override": 8},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["overrides"] == {"story_points_enabled": False, "story_points_max": 8}
    assert body["effective"] == {"story_points_enabled": False, "story_points_max": 8}
    assert body["provenance"] == {
        "story_points_enabled": "project",
        "story_points_max": "project",
    }
    assert await settings_row_count(pid) == 1

    reset = await patch_settings(
        tenant.http,
        tenant.slug,
        {"story_points_max_override": None},
    )
    assert reset.status_code == 200
    assert reset.json()["overrides"]["story_points_max"] is None
    assert reset.json()["effective"]["story_points_max"] == 100

    cleared = await patch_settings(
        tenant.http,
        tenant.slug,
        {"story_points_enabled_override": None},
    )
    assert cleared.status_code == 200
    assert cleared.json()["overrides"] == {
        "story_points_enabled": None,
        "story_points_max": None,
    }
    assert await settings_row_count(pid) == 0


async def test_project_max_cannot_exceed_organization_max(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    await tenant.http.patch(
        org_settings_path(tenant.slug),
        json={"story_points_max": 21},
        headers={"X-CSRF-Token": await csrf(tenant.http)},
    )
    response = await patch_settings(
        tenant.http, tenant.slug, {"story_points_max_override": 50}
    )
    assert response.status_code == 422
    assert response.json()["code"] == "validation_error"


async def test_cannot_re_enable_when_organization_disabled(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    await tenant.http.patch(
        org_settings_path(tenant.slug),
        json={"story_points_enabled": False},
        headers={"X-CSRF-Token": await csrf(tenant.http)},
    )
    response = await patch_settings(
        tenant.http, tenant.slug, {"story_points_enabled_override": True}
    )
    assert response.status_code == 422


async def test_viewer_can_read_member_cannot_patch(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    async with AsyncExitStack() as stack:
        viewer_http = await stack.enter_async_context(auth_client())
        await flush_test_redis()
        _, viewer_id = await verified_user(viewer_http)
        await add_member(tenant.org_id, viewer_id, "member")
        base = f"/api/v1/orgs/{tenant.slug}/projects/WEB"
        add = await tenant.http.post(
            f"{base}/members",
            json={"user_id": str(viewer_id), "role": "viewer"},
            headers={"X-CSRF-Token": await csrf(tenant.http)},
        )
        assert add.status_code == 204
        assert (await viewer_http.get(settings_path(tenant.slug))).status_code == 200
        patch = await patch_settings(viewer_http, tenant.slug, {"story_points_max_override": 5})
    assert patch.status_code == 403


async def test_patch_writes_audit_event(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    await patch_settings(tenant.http, tenant.slug, {"story_points_max_override": 13})
    actions = await audit_actions(tenant.org_id)
    assert actions[-1][0] == "project.settings.updated"
    assert "story_points_max_override" in actions[-1][1]
    assert "WEB" in actions[-1][1]


async def test_archived_project_rejects_settings_patch(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    archive = await tenant.http.post(
        f"/api/v1/orgs/{tenant.slug}/projects/WEB/archive",
        headers={"X-CSRF-Token": await csrf(tenant.http)},
    )
    assert archive.status_code == 204
    response = await patch_settings(tenant.http, tenant.slug, {"story_points_max_override": 5})
    assert response.status_code == 409
    assert response.json()["code"] == "project_archived"


async def test_org_max_decrease_conflicts_until_override_reset(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    assert (
        await patch_settings(tenant.http, tenant.slug, {"story_points_max_override": 50})
    ).status_code == 200
    org_patch = await tenant.http.patch(
        org_settings_path(tenant.slug),
        json={"story_points_max": 21},
        headers={"X-CSRF-Token": await csrf(tenant.http)},
    )
    assert org_patch.status_code == 200
    conflict = await tenant.http.get(settings_path(tenant.slug))
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "project_settings_conflict"
    fields = {e["field"] for e in conflict.json()["errors"]}
    assert "story_points_max_override" in fields

    fixed = await patch_settings(
        tenant.http, tenant.slug, {"story_points_max_override": None}
    )
    assert fixed.status_code == 200
    assert fixed.json()["effective"]["story_points_max"] == 21
    assert (await tenant.http.get(settings_path(tenant.slug))).status_code == 200


async def test_conflict_recovery_via_corrected_max_override(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    assert (
        await patch_settings(tenant.http, tenant.slug, {"story_points_max_override": 50})
    ).status_code == 200
    await tenant.http.patch(
        org_settings_path(tenant.slug),
        json={"story_points_max": 21},
        headers={"X-CSRF-Token": await csrf(tenant.http)},
    )
    conflict = await tenant.http.get(settings_path(tenant.slug))
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "project_settings_conflict"

    corrected = await patch_settings(
        tenant.http, tenant.slug, {"story_points_max_override": 8}
    )
    assert corrected.status_code == 200
    assert corrected.json()["effective"]["story_points_max"] == 8
    assert (await tenant.http.get(settings_path(tenant.slug))).status_code == 200


async def test_failed_settings_patch_does_not_persist_or_audit(tenant: Tenant) -> None:
    csrf_h = {"X-CSRF-Token": await csrf(tenant.http)}

    await create_project(tenant.http, tenant.slug, key="WEB")
    await tenant.http.patch(
        org_settings_path(tenant.slug),
        json={"story_points_max": 21},
        headers=csrf_h,
    )
    audits = await settings_updated_audit_count(tenant.org_id)
    pid = await project_id_for(tenant.org_id, "WEB")
    assert await stored_overrides(pid) == (None, None)
    invalid_max = await patch_settings(
        tenant.http, tenant.slug, {"story_points_max_override": 50}, key="WEB"
    )
    assert invalid_max.status_code == 422
    assert await stored_overrides(pid) == (None, None)
    assert await settings_updated_audit_count(tenant.org_id) == audits

    await create_project(tenant.http, tenant.slug, key="API")
    await tenant.http.patch(
        org_settings_path(tenant.slug),
        json={"story_points_enabled": False},
        headers=csrf_h,
    )
    audits = await settings_updated_audit_count(tenant.org_id)
    api_id = await project_id_for(tenant.org_id, "API")
    re_enable = await patch_settings(
        tenant.http,
        tenant.slug,
        {"story_points_enabled_override": True},
        key="API",
    )
    assert re_enable.status_code == 422
    assert await stored_overrides(api_id) == (None, None)
    assert await settings_updated_audit_count(tenant.org_id) == audits

    await create_project(tenant.http, tenant.slug, key="MOB")
    assert (
        await patch_settings(
            tenant.http, tenant.slug, {"story_points_max_override": 5}, key="MOB"
        )
    ).status_code == 200
    mob_id = await project_id_for(tenant.org_id, "MOB")
    audits = await settings_updated_audit_count(tenant.org_id)
    assert await stored_overrides(mob_id) == (None, 5)
    archive = await tenant.http.post(
        f"/api/v1/orgs/{tenant.slug}/projects/MOB/archive",
        headers=csrf_h,
    )
    assert archive.status_code == 204
    archived_patch = await patch_settings(
        tenant.http, tenant.slug, {"story_points_max_override": 8}, key="MOB"
    )
    assert archived_patch.status_code == 409
    assert archived_patch.json()["code"] == "project_archived"
    assert await stored_overrides(mob_id) == (None, 5)
    assert await settings_updated_audit_count(tenant.org_id) == audits


async def test_org_disable_conflicts_with_stored_re_enable_override(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    assert (
        await patch_settings(
            tenant.http, tenant.slug, {"story_points_enabled_override": True}
        )
    ).status_code == 200
    org_patch = await tenant.http.patch(
        org_settings_path(tenant.slug),
        json={"story_points_enabled": False},
        headers={"X-CSRF-Token": await csrf(tenant.http)},
    )
    assert org_patch.status_code == 200
    conflict = await tenant.http.get(settings_path(tenant.slug))
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "project_settings_conflict"
    assert "story_points_enabled_override" in {
        e["field"] for e in conflict.json()["errors"]
    }
    fixed = await patch_settings(
        tenant.http, tenant.slug, {"story_points_enabled_override": None}
    )
    assert fixed.status_code == 200
    assert fixed.json()["effective"]["story_points_enabled"] is False
    assert (await tenant.http.get(settings_path(tenant.slug))).status_code == 200


async def test_cross_tenant_project_settings_are_not_found(tenant: Tenant) -> None:
    await create_project(tenant.http, tenant.slug)
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
        assert (await other.http.get(settings_path(tenant.slug))).status_code == 404
        assert (
            await patch_settings(other.http, tenant.slug, {"story_points_max_override": 5})
        ).status_code == 404
