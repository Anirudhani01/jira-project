"""A3.2 Phase 4: organization authentication activity API."""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from datetime import UTC, datetime, timedelta

import pytest

from tests.integration.auth_support import auth_client, flush_test_redis, superuser_sql
from tests.integration.org_auth_projection_support import (
    random_synthetic_platform_event_id,
    synthetic_platform_event_id,
)
from tests.integration.tenancy_support import Tenant, add_member, make_tenant, verified_user

pytestmark = pytest.mark.integration
pytest_plugins = ["tests.integration.test_orgs"]


@pytest.fixture
async def two_tenants() -> AsyncIterator[tuple[Tenant, Tenant]]:
    async with AsyncExitStack() as stack:
        a = await make_tenant(stack, "alpha")
        await flush_test_redis()
        b = await make_tenant(stack, "bravo")
        yield a, b


BASE_TIME = datetime(2026, 7, 1, 12, 0, 0, tzinfo=UTC)


def activity_path(slug: str) -> str:
    return f"/api/v1/orgs/{slug}/authentication-activity"


async def insert_activity_row(
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    display_name: str = "Auth User",
    event_type: str = "auth.login.succeeded",
    outcome: str = "success",
    reason: str | None = "test_reason",
    metadata: dict[str, object] | None = None,
    occurred_at: datetime = BASE_TIME,
    platform_event_id: int | None = None,
) -> int:
    pid = (
        platform_event_id if platform_event_id is not None else random_synthetic_platform_event_id()
    )
    md = json.dumps(metadata or {"sessions_evicted": 1, "ip": "10.0.0.1"})
    [row] = await superuser_sql(
        "INSERT INTO org_authentication_events "
        "(org_id, user_id, platform_event_id, event_type, outcome, reason, metadata, "
        "member_display_name, occurred_at) "
        "VALUES (:o, :u, :p, :t, :out, :reason, CAST(:md AS jsonb), :name, :at) "
        "RETURNING id",
        o=org_id,
        u=user_id,
        p=pid,
        t=event_type,
        out=outcome,
        reason=reason,
        md=md,
        name=display_name,
        at=occurred_at,
    )
    return int(row.id)


async def test_authentication_activity_is_limited_to_owners_and_admins(tenant: Tenant) -> None:
    await insert_activity_row(org_id=tenant.org_id, user_id=tenant.user_id)
    path = activity_path(tenant.slug)
    owner = await tenant.http.get(path)
    assert owner.status_code == 200
    assert len(owner.json()["items"]) >= 1
    for role, expected in (("admin", 200), ("member", 403)):
        async with auth_client() as other:
            _, user_id = await verified_user(other)
            await add_member(tenant.org_id, user_id, role)
            assert (await other.get(path)).status_code == expected
    async with auth_client() as outsider:
        await verified_user(outsider)
        assert (await outsider.get(path)).status_code == 404
    async with auth_client() as anon:
        assert (await anon.get(path)).status_code == 401


async def test_former_member_activity_remains_visible_with_removed_status(
    tenant: Tenant,
) -> None:
    async with auth_client() as member_client:
        _, member_id = await verified_user(member_client)
        await add_member(tenant.org_id, member_id, "member")
    row_id = await insert_activity_row(
        org_id=tenant.org_id,
        user_id=member_id,
        display_name="Former Member",
        occurred_at=BASE_TIME - timedelta(days=1),
    )
    await superuser_sql(
        "UPDATE org_memberships SET removed_at = now() WHERE org_id = :o AND user_id = :u",
        o=tenant.org_id,
        u=member_id,
    )
    response = await tenant.http.get(activity_path(tenant.slug), params={"member": str(member_id)})
    assert response.status_code == 200
    [item] = response.json()["items"]
    assert item["id"] == row_id
    assert item["member_display_name"] == "Former Member"
    assert item["member_status"] == "removed"


async def test_member_event_type_and_date_filters(tenant: Tenant) -> None:
    other_id = uuid.uuid4()
    await superuser_sql(
        "INSERT INTO users (id, email, display_name, password_hash) "
        "VALUES (:u, :e, 'Filter User', 'x')",
        u=other_id,
        e=f"filter-{other_id.hex[:12]}@example.com",
    )
    await insert_activity_row(
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        event_type="auth.login.succeeded",
        occurred_at=BASE_TIME,
        platform_event_id=synthetic_platform_event_id(1001),
    )
    await insert_activity_row(
        org_id=tenant.org_id,
        user_id=other_id,
        event_type="auth.logout",
        occurred_at=BASE_TIME + timedelta(hours=1),
        platform_event_id=synthetic_platform_event_id(1002),
    )
    path = activity_path(tenant.slug)
    by_member = (await tenant.http.get(path, params={"member": str(tenant.user_id)})).json()[
        "items"
    ]
    assert {i["event_type"] for i in by_member} == {"auth.login.succeeded"}
    by_type = (await tenant.http.get(path, params={"event_type": "auth.logout"})).json()["items"]
    assert len(by_type) == 1
    assert by_type[0]["user_id"] == str(other_id)
    in_window = (
        await tenant.http.get(
            path,
            params={
                "from": (BASE_TIME + timedelta(minutes=30)).isoformat(),
                "to": (BASE_TIME + timedelta(hours=2)).isoformat(),
            },
        )
    ).json()["items"]
    assert len(in_window) == 1
    assert in_window[0]["event_type"] == "auth.logout"


async def test_cursor_pagination_and_limit_cap(tenant: Tenant) -> None:
    for index in range(4):
        await insert_activity_row(
            org_id=tenant.org_id,
            user_id=tenant.user_id,
            occurred_at=BASE_TIME + timedelta(minutes=index),
            platform_event_id=synthetic_platform_event_id(2000 + index),
        )
    path = activity_path(tenant.slug)
    pages: list[dict[str, object]] = []
    cursor: str | None = None
    for _ in range(4):
        params: dict[str, str | int] = {"limit": 2}
        if cursor is not None:
            params["cursor"] = cursor
        page_obj = (await tenant.http.get(path, params=params)).json()
        assert isinstance(page_obj, dict)
        page: dict[str, object] = page_obj
        pages.append(page)
        next_cursor = page.get("next_cursor")
        cursor = next_cursor if isinstance(next_cursor, str) else None
        if cursor is None:
            break
    ids: list[int] = []
    for page in pages:
        items_obj = page.get("items")
        assert isinstance(items_obj, list)
        for item in items_obj:
            assert isinstance(item, dict)
            raw_id = item["id"]
            assert isinstance(raw_id, int)
            ids.append(raw_id)
    assert len(ids) == 4
    assert len(ids) == len(set(ids))
    assert ids == sorted(ids, reverse=True)
    assert pages[-1]["next_cursor"] is None
    assert (await tenant.http.get(path, params={"limit": 101})).status_code == 422
    default_page = (await tenant.http.get(path)).json()
    assert len(default_page["items"]) == 4


async def test_from_is_inclusive_and_to_is_exclusive(tenant: Tenant) -> None:
    path = activity_path(tenant.slug)
    times = [
        BASE_TIME,
        BASE_TIME + timedelta(hours=1),
        BASE_TIME + timedelta(hours=2),
    ]
    for index, at in enumerate(times):
        await insert_activity_row(
            org_id=tenant.org_id,
            user_id=tenant.user_id,
            occurred_at=at,
            platform_event_id=synthetic_platform_event_id(4000 + index),
        )
    window = (
        await tenant.http.get(
            path,
            params={
                "from": times[1].isoformat(),
                "to": times[2].isoformat(),
            },
        )
    ).json()["items"]
    assert len(window) == 1
    at = datetime.fromisoformat(window[0]["occurred_at"].replace("Z", "+00:00"))
    assert at == times[1]
    assert at >= times[1]
    assert at < times[2]


async def test_default_page_size_is_fifty(tenant: Tenant) -> None:
    for index in range(51):
        await insert_activity_row(
            org_id=tenant.org_id,
            user_id=tenant.user_id,
            occurred_at=BASE_TIME + timedelta(seconds=index),
            platform_event_id=synthetic_platform_event_id(5000 + index),
        )
    first = (await tenant.http.get(activity_path(tenant.slug))).json()
    assert len(first["items"]) == 50
    assert first["next_cursor"] is not None


async def test_invalid_filters_use_problem_json(tenant: Tenant) -> None:
    path = activity_path(tenant.slug)
    assert (await tenant.http.get(path, params={"member": "not-a-uuid"})).status_code == 422
    bad_cursor = await tenant.http.get(path, params={"cursor": "not-valid"})
    assert bad_cursor.status_code == 400
    assert bad_cursor.json()["code"] == "invalid_cursor"
    bad_type = await tenant.http.get(path, params={"event_type": "auth.signup.requested"})
    assert bad_type.status_code == 400
    assert bad_type.json()["code"] == "invalid_event_type"
    bad_range = await tenant.http.get(
        path,
        params={
            "from": BASE_TIME.isoformat(),
            "to": (BASE_TIME - timedelta(hours=1)).isoformat(),
        },
    )
    assert bad_range.status_code == 400
    assert bad_range.json()["code"] == "invalid_date_range"


async def test_response_redacts_sensitive_fields(tenant: Tenant) -> None:
    sensitive_sentinels = (
        "203.0.113.1",
        "SecretAgent/1.0",
        "req-sentinel-7f3a",
        "leak@secret.example",
        "email-hmac-sentinel-deadbeef",
        "access-token-sentinel-aa11",
        "refresh-token-sentinel-bb22",
        "plain-password-sentinel",
        "bcrypt-hash-sentinel",
        "reset-secret-sentinel-cc33",
        "projection failure: operator table lock timeout",
        "internal stack frame 0xdeadbeef",
    )
    forbidden_metadata_keys = (
        "ip",
        "user_agent",
        "request_id",
        "email",
        "email_hmac",
        "access_token",
        "refresh_token",
        "password",
        "password_hash",
        "reset_token",
        "reset_secret",
        "platform_event_id",
        "failure_message",
        "operator_detail",
        "nested",
    )
    await insert_activity_row(
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        event_type="auth.login.succeeded",
        metadata={
            "sessions_evicted": 3,
            "rehashed": False,
            "ip": sensitive_sentinels[0],
            "user_agent": sensitive_sentinels[1],
            "request_id": sensitive_sentinels[2],
            "email": sensitive_sentinels[3],
            "email_hmac": sensitive_sentinels[4],
            "access_token": sensitive_sentinels[5],
            "refresh_token": sensitive_sentinels[6],
            "password": sensitive_sentinels[7],
            "password_hash": sensitive_sentinels[8],
            "reset_secret": sensitive_sentinels[9],
            "failure_message": sensitive_sentinels[10],
            "operator_detail": sensitive_sentinels[11],
            "platform_event_id": 424242,
            "nested": {
                "email": "nested-leak@evil.example",
                "access_token": "nested-access-token-sentinel",
            },
        },
    )
    payload = (await tenant.http.get(activity_path(tenant.slug))).json()
    text = json.dumps(payload)
    for sentinel in sensitive_sentinels:
        assert sentinel not in text
    assert "nested-leak@evil.example" not in text
    assert "nested-access-token-sentinel" not in text
    for key in forbidden_metadata_keys:
        assert f'"{key}"' not in text
    assert "platform_event_id" not in text
    [item] = payload["items"]
    assert item["metadata"] == {"sessions_evicted": 3, "rehashed": False}


async def test_multi_org_users_only_see_their_org_projection_rows(
    two_tenants: tuple[Tenant, Tenant],
) -> None:
    a, b = two_tenants
    shared_user = a.user_id
    await superuser_sql(
        "INSERT INTO org_memberships (org_id, user_id, role, created_at) "
        "VALUES (:o, :u, 'member', now())",
        o=b.org_id,
        u=shared_user,
    )
    await insert_activity_row(
        org_id=a.org_id,
        user_id=shared_user,
        platform_event_id=synthetic_platform_event_id(3001),
        occurred_at=BASE_TIME,
    )
    await insert_activity_row(
        org_id=b.org_id,
        user_id=shared_user,
        platform_event_id=synthetic_platform_event_id(3002),
        occurred_at=BASE_TIME + timedelta(minutes=1),
    )
    a_items = (await a.http.get(activity_path(a.slug))).json()["items"]
    b_items = (await b.http.get(activity_path(b.slug))).json()["items"]
    assert len(a_items) == 1
    assert len(b_items) == 1
    assert a_items[0]["id"] != b_items[0]["id"]
