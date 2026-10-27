"""Regressions for the M1 security review and denial-boundary checks.

Each test asserts the *effect* of a rejected request (no state change, no session, no
leaked value), not only the status code.
"""

import asyncio
import os
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.db.engine import create_db_engine
from app.main import create_app
from tests.integration.auth_support import (
    ORIGIN,
    OTHER_PASSWORD,
    STRONG_PASSWORD,
    auth_client,
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
WRONG = "Wrong-Password-Guess-77"
REDIS_DOWN = SecretStr("redis://127.0.0.1:1/0")


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


async def _active_sessions(email: str) -> int:
    rows = await superuser_sql(
        "SELECT count(*) FROM user_sessions s JOIN users u ON u.id = s.user_id "
        "WHERE u.email = :e AND s.revoked_at IS NULL",
        e=email,
    )
    return int(rows[0][0])


# ------------------------------------------------ F1: rate limits under concurrency
@pytest.mark.parametrize("redis_url", [None, REDIS_DOWN], ids=["redis", "fallback"])
async def test_parallel_login_burst_is_capped(redis_url: SecretStr | None) -> None:
    overrides: dict[str, Any] = {"redis_url": redis_url} if redis_url else {}
    async with auth_client(**overrides) as http:
        email = unique_email()
        await signup(http, email)
        responses = await asyncio.gather(*(login(http, email, WRONG) for _ in range(25)))
    codes = [r.status_code for r in responses]
    assert codes.count(401) == 5, codes
    assert codes.count(429) == 20, codes


async def test_correct_password_is_refused_while_rate_limited() -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        for _ in range(5):
            await login(http, email, WRONG)
        blocked = await login(http, email, STRONG_PASSWORD)
        assert blocked.status_code == 429
        assert "set-cookie" not in blocked.headers
    assert await _active_sessions(email) == 0


async def test_successful_logins_do_not_consume_failure_budget() -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        for _ in range(8):
            assert (await login(http, email)).status_code == 204
        for _ in range(5):
            assert (await login(http, email, WRONG)).status_code == 401
        assert (await login(http, email, WRONG)).status_code == 429


async def test_parallel_signup_burst_is_capped() -> None:
    async with auth_client() as http:
        responses = await asyncio.gather(*(signup(http, unique_email()) for _ in range(12)))
    codes = [r.status_code for r in responses]
    assert codes.count(202) == 5, codes
    assert codes.count(429) == 7, codes


# ------------------------------------------------- F2: no SQL parameters in errors
async def test_database_errors_do_not_embed_bound_parameters() -> None:
    engine = create_db_engine(integration_settings())
    secret = "$argon2id$v=19$m=65536$SECRET-HASH-VALUE"
    try:
        async with engine.connect() as conn:
            with pytest.raises(DBAPIError) as excinfo:
                await conn.execute(text("SELECT CAST(:v AS int)"), {"v": secret})
    finally:
        await engine.dispose()
    assert secret not in str(excinfo.value)
    assert "SECRET-HASH-VALUE" not in repr(excinfo.value)


# ------------------------------------------------ F3: untrusted / malformed peers
async def test_non_ip_peer_is_not_stored_and_login_still_works() -> None:
    app = create_app(integration_settings(), configure_logs=False)
    transport = httpx.ASGITransport(app=app, client=("not-an-ip", 4321))
    async with (
        running_app(app),
        httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers={"Origin": ORIGIN}) as http,
    ):
        email = unique_email()
        assert (await signup(http, email)).status_code == 202
        assert (await login(http, email)).status_code == 204
    rows = await superuser_sql(
        "SELECT e.ip FROM security.platform_security_events e JOIN users u ON u.id = e.user_id "
        "WHERE u.email = :e AND e.event_type = 'auth.login.succeeded'",
        e=email,
    )
    assert [r.ip for r in rows] == [None]


async def test_forwarded_for_header_is_ignored_without_trusted_proxy() -> None:
    """Without FORWARDED_ALLOW_IPS trust, a client-chosen X-Forwarded-For has no effect."""
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        for i in range(5):
            await login(http, email, WRONG)
            http.headers["X-Forwarded-For"] = f"198.51.100.{i}"
        assert (await login(http, email, WRONG)).status_code == 429


# --------------------------------------- F6: credentials changed during verification
async def test_session_not_issued_if_password_changed_during_verification() -> None:
    app = create_app(integration_settings(), configure_logs=False)
    services = app.state.identity
    original_verify = services.hashing.verify

    async def verify_then_change(stored: str | None, password: str) -> bool:
        ok: bool = await original_verify(stored, password)
        await superuser_sql("UPDATE users SET password_hash = 'changed' WHERE email = :e", e=email)
        return ok

    email = unique_email()
    async with (
        running_app(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url=ORIGIN, headers={"Origin": ORIGIN}
        ) as http,
    ):
        await signup(http, email)
        services.hashing.verify = verify_then_change
        response = await login(http, email)
    assert response.status_code == 401
    assert await _active_sessions(email) == 0


# ------------------------------------------------- denial boundaries: no side effects
async def test_rejected_csrf_requests_change_nothing() -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        await login(http, email)
        other_token = None
        async with auth_client() as other:
            other_email = unique_email()
            await signup(other, other_email)
            await login(other, other_email)
            other_token = await csrf(other)  # valid token, wrong session

        for headers in ({}, {"X-CSRF-Token": other_token}, {"X-CSRF-Token": "x" * 64}):
            assert (
                await http.patch("/api/v1/me", json={"display_name": "Changed"}, headers=headers)
            ).status_code == 403
            assert (await http.post("/api/v1/auth/logout", headers=headers)).status_code == 403
            assert (
                await http.post(
                    "/api/v1/me/password",
                    json={"current_password": STRONG_PASSWORD, "new_password": OTHER_PASSWORD},
                    headers=headers,
                )
            ).status_code == 403
            assert (
                await http.post("/api/v1/me/sessions/revoke-others", headers=headers)
            ).status_code == 403

        state = (await http.get("/api/v1/auth/session")).json()
        assert state["user"]["display_name"] == "Test User"
        assert await _active_sessions(email) == 1
        ((stored,),) = await superuser_sql(
            "SELECT password_hash FROM users WHERE email = :e", e=email
        )
        async with auth_client() as fresh:
            assert (await login(fresh, email, STRONG_PASSWORD)).status_code == 204
        assert stored.startswith("$argon2id$")


@pytest.mark.parametrize("origin", ["https://evil.test", None])
async def test_cross_origin_login_creates_no_session(origin: str | None) -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        http.headers.pop("Origin")
        headers = {"Origin": origin} if origin else {}
        response = await http.post(
            "/api/v1/auth/login",
            json={"email": email, "password": STRONG_PASSWORD},
            headers=headers,
        )
    assert response.status_code == 403
    assert "set-cookie" not in response.headers
    assert await _active_sessions(email) == 0


async def test_cross_origin_signup_creates_no_user() -> None:
    async with auth_client() as http:
        email = unique_email()
        http.headers["Origin"] = "https://evil.test"
        assert (await signup(http, email)).status_code == 403
    assert await superuser_sql("SELECT 1 FROM users WHERE email = :e", e=email) == []


async def test_session_endpoints_reveal_nothing_without_session() -> None:
    async with auth_client() as http:
        for method, path in (
            ("GET", "/api/v1/auth/session"),
            ("GET", "/api/v1/me/sessions"),
            ("PATCH", "/api/v1/me"),
            ("POST", "/api/v1/me/password"),
            ("POST", "/api/v1/me/sessions/revoke-others"),
            ("DELETE", "/api/v1/me/sessions/00000000-0000-0000-0000-000000000000"),
        ):
            response = await http.request(method, path, json={} if method != "GET" else None)
            assert response.status_code in (401, 422), (method, path, response.status_code)
            assert "csrf_token" not in response.text
            assert "@" not in response.text


async def test_tampered_or_oversized_cookie_is_rejected() -> None:
    async with auth_client() as http:
        email = unique_email()
        await signup(http, email)
        await login(http, email)
        token = str(http.cookies.get(COOKIE))
        for forged in (token[:-1] + ("A" if token[-1] != "A" else "B"), token + "x" * 200, ""):
            http.cookies.set(COOKIE, forged, domain="app.test")
            assert (await http.get("/api/v1/auth/session")).status_code == 401


def test_test_database_is_not_the_dev_database() -> None:
    """Guard: these tests write users; never point them at the dev database."""
    assert os.environ["TEST_DATABASE_URL"].rsplit("/", 1)[-1].endswith("_test")
