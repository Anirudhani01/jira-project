"""Session policy (plan V2.4, D2/D6), CSRF, account endpoints."""

import asyncio
from collections.abc import AsyncIterator
from typing import Annotated

import httpx
import pytest
from fastapi import Depends

from app.main import create_app
from app.modules.identity.deps import AuthContext, require_session
from tests.integration.auth_support import (
    OTHER_PASSWORD,
    STRONG_PASSWORD,
    auth_client,
    client_for,
    csrf,
    flush_test_redis,
    integration_settings,
    login,
    running_app,
    signup,
    superuser_sql,
    unique_email,
)

COOKIE = "__Host-session"


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with auth_client() as client:
        yield client


async def logged_in(http: httpx.AsyncClient, email: str | None = None) -> str:
    email = email or unique_email()
    await signup(http, email)
    assert (await login(http, email)).status_code == 204
    return email


async def second_device(http: httpx.AsyncClient, email: str) -> httpx.AsyncClient:
    other = client_for(http._transport.app)  # type: ignore[attr-defined]
    assert (await login(other, email)).status_code == 204
    return other


# ------------------------------------------------------------------------------- CSRF
async def test_authenticated_unsafe_request_requires_csrf_token(http: httpx.AsyncClient) -> None:
    await logged_in(http)
    missing = await http.patch("/api/v1/me", json={"display_name": "New Name"})
    assert missing.status_code == 403
    assert missing.json()["code"] == "csrf_failed"
    wrong = await http.patch(
        "/api/v1/me", json={"display_name": "New Name"}, headers={"X-CSRF-Token": "0" * 64}
    )
    assert wrong.status_code == 403
    ok = await http.patch(
        "/api/v1/me", json={"display_name": "New Name"}, headers={"X-CSRF-Token": await csrf(http)}
    )
    assert ok.status_code == 200
    assert ok.json()["display_name"] == "New Name"


async def test_csrf_token_from_another_session_is_rejected(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)
    other = await second_device(http, email)
    try:
        foreign_token = await csrf(other)
        response = await http.patch(
            "/api/v1/me", json={"display_name": "X"}, headers={"X-CSRF-Token": foreign_token}
        )
        assert response.status_code == 403
    finally:
        await other.aclose()


async def test_csrf_token_rotates_with_session(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)
    first = await csrf(http)
    await login(http, email)  # new session replaces the cookie
    assert await csrf(http) != first


# ----------------------------------------------------------------------- logout/revoke
async def test_logout_revokes_only_current_session(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)
    other = await second_device(http, email)
    try:
        response = await http.post(
            "/api/v1/auth/logout", headers={"X-CSRF-Token": await csrf(http)}
        )
        assert response.status_code == 204
        assert COOKIE in response.headers["set-cookie"]
        assert "max-age=0" in response.headers["set-cookie"].lower()
        assert (await http.get("/api/v1/auth/session")).status_code == 401
        assert (await other.get("/api/v1/auth/session")).status_code == 200
    finally:
        await other.aclose()


async def test_logout_without_session_is_idempotent(http: httpx.AsyncClient) -> None:
    assert (await http.post("/api/v1/auth/logout")).status_code == 204


async def test_revoked_cookie_cannot_be_replayed(http: httpx.AsyncClient) -> None:
    await logged_in(http)
    stolen = http.cookies.get(COOKIE)
    await http.post("/api/v1/auth/logout", headers={"X-CSRF-Token": await csrf(http)})
    http.cookies.set(COOKIE, str(stolen), domain="app.test")
    assert (await http.get("/api/v1/auth/session")).status_code == 401


async def test_revoke_others_keeps_current(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)
    others = [await second_device(http, email) for _ in range(2)]
    try:
        response = await http.post(
            "/api/v1/me/sessions/revoke-others", headers={"X-CSRF-Token": await csrf(http)}
        )
        assert response.status_code == 204
        assert (await http.get("/api/v1/auth/session")).status_code == 200
        for other in others:
            assert (await other.get("/api/v1/auth/session")).status_code == 401
        items = (await http.get("/api/v1/me/sessions")).json()["items"]
        assert len(items) == 1
        assert items[0]["current"] is True
    finally:
        for other in others:
            await other.aclose()


async def test_cannot_revoke_another_users_session(http: httpx.AsyncClient) -> None:
    await logged_in(http)
    async with auth_client() as stranger:
        await logged_in(stranger)
        stranger_session = (await stranger.get("/api/v1/me/sessions")).json()["items"][0]["id"]
        response = await http.delete(
            f"/api/v1/me/sessions/{stranger_session}", headers={"X-CSRF-Token": await csrf(http)}
        )
        assert response.status_code == 404
        assert (await stranger.get("/api/v1/auth/session")).status_code == 200


async def test_revoking_current_session_by_id_clears_cookie(http: httpx.AsyncClient) -> None:
    await logged_in(http)
    current = (await http.get("/api/v1/me/sessions")).json()["items"][0]["id"]
    response = await http.delete(
        f"/api/v1/me/sessions/{current}", headers={"X-CSRF-Token": await csrf(http)}
    )
    assert response.status_code == 204
    assert "max-age=0" in response.headers["set-cookie"].lower()
    assert (await http.get("/api/v1/auth/session")).status_code == 401


# ------------------------------------------------------------------------- password
async def test_password_change_rotates_current_and_revokes_others(
    http: httpx.AsyncClient,
) -> None:
    email = await logged_in(http)
    old_cookie = http.cookies.get(COOKIE)
    other = await second_device(http, email)
    try:
        response = await http.post(
            "/api/v1/me/password",
            json={"current_password": STRONG_PASSWORD, "new_password": OTHER_PASSWORD},
            headers={"X-CSRF-Token": await csrf(http)},
        )
        assert response.status_code == 204
        assert http.cookies.get(COOKIE) != old_cookie
        assert (await http.get("/api/v1/auth/session")).status_code == 200
        assert (await other.get("/api/v1/auth/session")).status_code == 401
        replay = client_for(http._transport.app)  # type: ignore[attr-defined]
        replay.cookies.set(COOKIE, str(old_cookie), domain="app.test")
        assert (await replay.get("/api/v1/auth/session")).status_code == 401
        await replay.aclose()
        assert (await login(other, email, STRONG_PASSWORD)).status_code == 401
        assert (await login(other, email, OTHER_PASSWORD)).status_code == 204
    finally:
        await other.aclose()


async def test_password_change_rejects_wrong_current_and_breached_new(
    http: httpx.AsyncClient,
) -> None:
    email = await logged_in(http)
    token = await csrf(http)
    wrong = await http.post(
        "/api/v1/me/password",
        json={"current_password": OTHER_PASSWORD, "new_password": OTHER_PASSWORD},
        headers={"X-CSRF-Token": token},
    )
    assert wrong.status_code == 422
    assert wrong.json()["code"] == "invalid_current_password"
    weak = await http.post(
        "/api/v1/me/password",
        json={"current_password": STRONG_PASSWORD, "new_password": email.split("@")[0] + "-12345"},
        headers={"X-CSRF-Token": token},
    )
    assert weak.status_code == 422
    assert weak.json()["code"] == "password_rejected"


# ------------------------------------------------------------------- expiry and cap
async def test_idle_timeout_expires_session(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)
    await superuser_sql(
        "UPDATE user_sessions s SET last_seen_at = now() - interval '24 hours 1 minute' "
        "FROM users u WHERE u.id = s.user_id AND u.email = :e",
        e=email,
    )
    assert (await http.get("/api/v1/auth/session")).status_code == 401


async def test_absolute_expiry_applies_despite_activity(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)
    await superuser_sql(
        "UPDATE user_sessions s SET created_at = now() - interval '14 days', "
        "expires_at = now() - interval '1 second', last_seen_at = now() "
        "FROM users u WHERE u.id = s.user_id AND u.email = :e",
        e=email,
    )
    assert (await http.get("/api/v1/auth/session")).status_code == 401


async def test_last_seen_is_touched_at_most_every_five_minutes(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)
    sql = (
        "SELECT s.last_seen_at FROM user_sessions s JOIN users u ON u.id = s.user_id "
        "WHERE u.email = :e"
    )
    (before,) = await superuser_sql(sql, e=email)
    await http.get("/api/v1/auth/session")
    (unchanged,) = await superuser_sql(sql, e=email)
    assert unchanged.last_seen_at == before.last_seen_at
    await superuser_sql(
        "UPDATE user_sessions s SET last_seen_at = now() - interval '6 minutes' "
        "FROM users u WHERE u.id = s.user_id AND u.email = :e",
        e=email,
    )
    await http.get("/api/v1/auth/session")
    (touched,) = await superuser_sql(sql, e=email)
    assert touched.last_seen_at > before.last_seen_at


async def test_twenty_first_login_evicts_least_recently_used(http: httpx.AsyncClient) -> None:
    email = await logged_in(http)  # session 1
    first_cookie = http.cookies.get(COOKIE)
    await superuser_sql(
        "UPDATE user_sessions s SET last_seen_at = now() - interval '1 hour' "
        "FROM users u WHERE u.id = s.user_id AND u.email = :e",
        e=email,
    )
    devices = [client_for(http._transport.app) for _ in range(20)]  # type: ignore[attr-defined]
    try:
        for device in devices:  # sessions 2..21
            assert (await login(device, email)).status_code == 204
        (active,) = await superuser_sql(
            "SELECT count(*) FROM user_sessions s JOIN users u ON u.id = s.user_id "
            "WHERE u.email = :e AND s.revoked_at IS NULL",
            e=email,
        )
        assert active[0] == 20
        probe = client_for(http._transport.app)  # type: ignore[attr-defined]
        probe.cookies.set(COOKIE, str(first_cookie), domain="app.test")
        assert (await probe.get("/api/v1/auth/session")).status_code == 401
        await probe.aclose()
        assert all([(await d.get("/api/v1/auth/session")).status_code == 200 for d in devices])
    finally:
        for device in devices:
            await device.aclose()


# --------------------------------------------------------- in-flight vs revocation
async def test_request_started_before_revocation_completes_next_one_fails() -> None:
    app = create_app(integration_settings(), configure_logs=False)
    authenticated = asyncio.Event()
    release = asyncio.Event()

    @app.get("/api/v1/_test/slow")
    async def slow(auth: Annotated[AuthContext, Depends(require_session)]) -> dict[str, str]:
        authenticated.set()
        await release.wait()
        return {"user_id": str(auth.user_id)}

    async with running_app(app), client_for(app) as http:
        email = unique_email()
        await signup(http, email)
        await login(http, email)
        token = await csrf(http)
        revoked_cookie = str(http.cookies.get(COOKIE))
        in_flight = asyncio.create_task(http.get("/api/v1/_test/slow"))
        await authenticated.wait()
        logout = await http.post("/api/v1/auth/logout", headers={"X-CSRF-Token": token})
        assert logout.status_code == 204
        release.set()
        assert (await in_flight).status_code == 200
        http.cookies.set(COOKIE, revoked_cookie, domain="app.test")
        assert (await http.get("/api/v1/_test/slow")).status_code == 401
