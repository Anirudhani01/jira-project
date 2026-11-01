"""R3.5 test_api_cross_tenant, test_membership_resolution and the V2.6/V2.9 uniform-404
contract: every org route answers an inaccessible org with the same 404 (byte-identical
apart from request_id) and changes nothing; the org comes only from the caller's active
membership, never from request data."""

import json
import uuid

import httpx
import pytest

from app.authz.deps import OrgAccess
from app.authz.permissions import Permission, org_permissions
from app.core.errors import AppError
from app.main import create_app
from app.modules.orgs import service
from app.modules.orgs.repository import AuditFilter
from tests.integration.auth_support import integration_settings, running_app, superuser_sql
from tests.integration.tenancy_support import Tenant, add_backup_owner, checksum

VOLATILE = {"date", "x-request-id", "content-length"}


def org_requests(slug: str) -> list[tuple[str, str, dict[str, object] | None]]:
    return [
        ("GET", f"/api/v1/orgs/{slug}", None),
        ("PATCH", f"/api/v1/orgs/{slug}", {"name": "Taken over"}),
        ("GET", f"/api/v1/orgs/{slug}/issue-types", None),
        ("GET", f"/api/v1/orgs/{slug}/priorities", None),
        ("GET", f"/api/v1/orgs/{slug}/audit-events", None),
        ("GET", f"/api/v1/orgs/{slug}/authentication-activity", None),
        ("GET", f"/api/v1/orgs/{slug}/issues", None),
        ("GET", f"/api/v1/orgs/{slug}/issues/WEB-1", None),
        ("PATCH", f"/api/v1/orgs/{slug}/issues/WEB-1", {"summary": "Taken over"}),
        ("DELETE", f"/api/v1/orgs/{slug}/issues/WEB-1", None),
        ("GET", f"/api/v1/orgs/{slug}/issues/WEB-1/activity", None),
        ("POST", f"/api/v1/orgs/{slug}/projects/WEB/issues", {"summary": "x"}),
    ]


async def call(tenant: Tenant, method: str, path: str, body: object | None) -> httpx.Response:
    headers = await tenant.headers() if method != "GET" else {}
    return await tenant.http.request(method, path, json=body, headers=headers)


def fingerprint(response: httpx.Response) -> tuple[int, str, str]:
    payload = response.json()
    payload.pop("request_id", None)
    headers = {k: v for k, v in response.headers.items() if k.lower() not in VOLATILE}
    return response.status_code, json.dumps(payload, sort_keys=True), json.dumps(headers)


async def test_other_tenants_org_routes_are_404_and_change_nothing(
    two_tenants: tuple[Tenant, Tenant],
) -> None:
    a, b = two_tenants
    before = await checksum()
    for method, path, body in org_requests(b.slug):
        response = await call(a, method, path, body)
        assert response.status_code == 404, (method, path)
        assert response.json()["code"] == "not_found"
    assert await checksum() == before


async def test_inaccessible_orgs_are_indistinguishable(two_tenants: tuple[Tenant, Tenant]) -> None:
    """Existing-but-not-mine, unknown, malformed and removed-membership all look the same."""
    a, b = two_tenants
    unknown = f"nope-{uuid.uuid4().hex[:10]}"
    responses = []
    for slug in (b.slug, unknown, "x", "A--", "%2e%2e"):
        for method, path, body in org_requests(slug):
            if method == "GET":
                responses.append(await call(a, method, path, body))
    await add_backup_owner(a.org_id)
    await superuser_sql(
        "UPDATE org_memberships SET removed_at = now() WHERE org_id = :o AND user_id = :u",
        o=a.org_id,
        u=a.user_id,
    )
    responses.append(await call(a, "GET", f"/api/v1/orgs/{a.slug}", None))
    assert {fingerprint(r) for r in responses} == {fingerprint(responses[0])}
    assert responses[0].status_code == 404


async def test_removed_membership_loses_access_on_every_route(
    two_tenants: tuple[Tenant, Tenant],
) -> None:
    a, _ = two_tenants
    assert (await call(a, "GET", f"/api/v1/orgs/{a.slug}", None)).status_code == 200
    await add_backup_owner(a.org_id)
    await superuser_sql(
        "UPDATE org_memberships SET removed_at = now() WHERE org_id = :o AND user_id = :u",
        o=a.org_id,
        u=a.user_id,
    )
    for method, path, body in org_requests(a.slug):
        assert (await call(a, method, path, body)).status_code == 404, (method, path)
    listed = await a.http.get("/api/v1/orgs")
    assert listed.json()["items"] == []


async def test_slug_resolution_is_case_insensitive_and_exact(
    two_tenants: tuple[Tenant, Tenant],
) -> None:
    a, b = two_tenants
    upper = await call(a, "GET", f"/api/v1/orgs/{a.slug.upper()}", None)
    assert upper.status_code == 200
    assert upper.json()["slug"] == a.slug
    assert (await call(a, "GET", f"/api/v1/orgs/{b.slug.upper()}", None)).status_code == 404


@pytest.mark.parametrize(
    "body", [{"org_id": "B"}, {"name": "x", "id": "B"}, {"name": "x", "created_by": "B"}]
)
async def test_tenant_identifiers_in_request_bodies_are_rejected(
    two_tenants: tuple[Tenant, Tenant], body: dict[str, str]
) -> None:
    a, b = two_tenants
    payload = {k: (str(b.org_id) if v == "B" else v) for k, v in body.items()}
    response = await call(a, "PATCH", f"/api/v1/orgs/{a.slug}", payload)
    assert response.status_code == 422
    [row] = await superuser_sql("SELECT name FROM organizations WHERE id = :b", b=b.org_id)
    assert row.name == "Acme"


async def test_handler_transaction_rechecks_membership_after_resolution(
    two_tenants: tuple[Tenant, Tenant],
) -> None:
    """Membership removed between resolution and the handler's transaction: 404, and a
    demotion between them is honoured too (no stale permissions)."""
    a, _ = two_tenants
    app = create_app(integration_settings(), configure_logs=False)
    access = OrgAccess(
        org_id=a.org_id,
        user_id=a.user_id,
        slug=a.slug,
        role="owner",
        can_create_projects=False,
        permissions=org_permissions("owner", can_create_projects=False),
    )
    await add_backup_owner(a.org_id)
    await superuser_sql(
        "UPDATE org_memberships SET role = 'member' WHERE org_id = :o AND user_id = :u",
        o=a.org_id,
        u=a.user_id,
    )
    async with running_app(app):
        services = app.state.identity
        with pytest.raises(AppError) as demoted:
            await service.list_audit_events(services, access, AuditFilter(), limit=5, cursor=None)
        assert demoted.value.status == 403
        await superuser_sql(
            "UPDATE org_memberships SET removed_at = now() WHERE org_id = :o AND user_id = :u",
            o=a.org_id,
            u=a.user_id,
        )
        with pytest.raises(AppError) as removed:
            await service.get_org(services, access)
        assert removed.value.status == 404
    assert Permission.ORG_AUDIT_VIEW in access.permissions  # the stale object said yes
