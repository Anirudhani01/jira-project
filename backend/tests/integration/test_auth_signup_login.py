"""Signup and login contract (plan R2, V2.3, D1) against real PostgreSQL/Redis."""

import asyncio
import json
import logging
import statistics
import time
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx
import pytest
from pydantic import SecretStr

from app.main import create_app
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

VOLATILE_HEADERS = {"date", "x-request-id", "content-length"}


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with auth_client() as client:
        yield client


def comparable(response: httpx.Response) -> tuple[int, bytes, dict[str, str]]:
    body = response.json()
    if isinstance(body, dict):
        body.pop("request_id", None)
    headers = {k: v for k, v in response.headers.items() if k.lower() not in VOLATILE_HEADERS}
    return response.status_code, json.dumps(body, sort_keys=True).encode(), headers


# ------------------------------------------------------------------------------ signup
async def test_signup_is_identical_for_new_unverified_and_verified_emails(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    new = await signup(http, email)
    unverified_duplicate = await signup(http, email, OTHER_PASSWORD)
    await superuser_sql("UPDATE users SET email_verified_at = now() WHERE email = :e", e=email)
    verified_duplicate = await signup(http, email.upper(), OTHER_PASSWORD)

    assert new.status_code == 202
    assert new.json() == {"status": "accepted"}
    assert comparable(new) == comparable(unverified_duplicate) == comparable(verified_duplicate)
    for response in (new, unverified_duplicate, verified_duplicate):
        assert "set-cookie" not in response.headers
    # The duplicate attempt did not change the original account's password.
    assert (await login(http, email, STRONG_PASSWORD)).status_code == 204


async def test_signup_creates_unverified_user_with_argon2id_hash(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    (row,) = await superuser_sql(
        "SELECT password_hash, email_verified_at, status FROM users WHERE email = :e", e=email
    )
    assert row.password_hash.startswith("$argon2id$")
    assert STRONG_PASSWORD not in row.password_hash
    assert row.email_verified_at is None
    assert row.status == "active"


async def test_concurrent_duplicate_signups_all_accepted_one_row(http: httpx.AsyncClient) -> None:
    email = unique_email()
    responses = await asyncio.gather(*(signup(http, email) for _ in range(4)))
    assert [r.status_code for r in responses] == [202] * 4
    (count,) = await superuser_sql("SELECT count(*) FROM users WHERE email = :e", e=email)
    assert count[0] == 1


async def test_signup_disabled_returns_404() -> None:
    async with auth_client(signup_enabled=False) as http:
        response = await signup(http, unique_email())
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"


@pytest.mark.parametrize("origin", [None, "https://evil.test", "http://app.test"])
async def test_signup_and_login_require_same_origin(origin: str | None) -> None:
    async with auth_client() as http:
        headers = {"Origin": origin} if origin else {}
        if origin is None:
            http.headers.pop("Origin")
        for path, body in (
            (
                "/api/v1/auth/signup",
                {"email": unique_email(), "password": STRONG_PASSWORD, "display_name": "X"},
            ),
            ("/api/v1/auth/login", {"email": unique_email(), "password": STRONG_PASSWORD}),
        ):
            response = await http.post(path, json=body, headers=headers)
            assert response.status_code == 403
            assert response.json()["code"] == "csrf_failed"


async def test_weak_password_rejected_before_any_account_lookup(http: httpx.AsyncClient) -> None:
    email = unique_email()
    response = await signup(http, email, "short")
    assert response.status_code == 422
    assert response.json()["code"] == "password_rejected"
    assert response.json()["errors"][0]["field"] == "body.password"
    assert await superuser_sql("SELECT 1 FROM users WHERE email = :e", e=email) == []


async def test_signup_rejects_unknown_fields(http: httpx.AsyncClient) -> None:
    response = await http.post(
        "/api/v1/auth/signup",
        json={
            "email": unique_email(),
            "password": STRONG_PASSWORD,
            "display_name": "X",
            "email_verified_at": "2020-01-01T00:00:00Z",
        },
    )
    assert response.status_code == 422


# ------------------------------------------------------------------------------- login
async def test_login_sets_hardened_session_cookie(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    response = await login(http, email)
    assert response.status_code == 204
    cookie = response.headers["set-cookie"]
    assert cookie.startswith("__Host-session=")
    lowered = cookie.lower()
    for attribute in ("httponly", "secure", "samesite=lax", "path=/", "max-age=1209600"):
        assert attribute in lowered
    assert "domain=" not in lowered


async def test_unverified_user_can_log_in_and_read_session(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    await login(http, email)
    state = (await http.get("/api/v1/auth/session")).json()
    assert state["user"]["email"] == email
    assert state["user"]["email_verified"] is False
    assert len(state["csrf_token"]) == 64


async def test_login_failures_are_indistinguishable(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    wrong_password = await login(http, email, OTHER_PASSWORD)
    unknown_email = await login(http, unique_email(), OTHER_PASSWORD)
    assert wrong_password.status_code == unknown_email.status_code == 401
    assert comparable(wrong_password) == comparable(unknown_email)
    assert wrong_password.json()["code"] == "invalid_credentials"


async def test_disabled_user_cannot_log_in_and_sessions_stop_working(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    await signup(http, email)
    await login(http, email)
    assert (await http.get("/api/v1/auth/session")).status_code == 200
    await superuser_sql("UPDATE users SET status = 'disabled' WHERE email = :e", e=email)
    assert (await http.get("/api/v1/auth/session")).status_code == 401
    assert (await login(http, email)).status_code == 401


async def test_unauthenticated_session_is_401_problem(http: httpx.AsyncClient) -> None:
    response = await http.get("/api/v1/auth/session")
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"


# ------------------------------------------------------------------------ rate limiting
async def _assert_login_rate_limited(http: httpx.AsyncClient) -> None:
    email = unique_email()
    for _ in range(5):
        assert (await login(http, email, OTHER_PASSWORD)).status_code == 401
    blocked = await login(http, email, OTHER_PASSWORD)
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "rate_limited"
    assert int(blocked.headers["retry-after"]) >= 1


async def test_login_rate_limited_after_five_failures(http: httpx.AsyncClient) -> None:
    await _assert_login_rate_limited(http)


async def test_login_rate_limit_holds_with_redis_down() -> None:
    async with auth_client(redis_url=SecretStr("redis://127.0.0.1:1/0")) as http:
        await _assert_login_rate_limited(http)


async def test_signup_rate_limited_per_ip(http: httpx.AsyncClient) -> None:
    for _ in range(5):
        assert (await signup(http, unique_email())).status_code == 202
    assert (await signup(http, unique_email())).status_code == 429


# -------------------------------------------------------------- security events/secrets
async def test_security_events_recorded_without_secrets(
    http: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    email = unique_email()
    unknown = unique_email()
    with caplog.at_level(logging.DEBUG):
        await signup(http, email)
        await login(http, email, OTHER_PASSWORD)
        await login(http, unknown, OTHER_PASSWORD)
        assert (await login(http, email)).status_code == 204
        token = await csrf(http)
        session_cookie = http.cookies.get("__Host-session")
        await http.post(
            "/api/v1/me/password",
            json={"current_password": STRONG_PASSWORD, "new_password": OTHER_PASSWORD},
            headers={"X-CSRF-Token": token},
        )
        await http.post("/api/v1/auth/logout", headers={"X-CSRF-Token": await csrf(http)})

    rows = await superuser_sql(
        "SELECT event_type, outcome, user_id, email_hmac, reason, metadata::text AS md, "
        "user_agent, ip::text AS ip FROM security.platform_security_events "
        "WHERE occurred_at > now() - interval '1 minute' ORDER BY id"
    )
    types = [r.event_type for r in rows]
    for expected in (
        "auth.signup.requested",
        "auth.login.failed",
        "auth.login.succeeded",
        "auth.password.changed",
        "auth.logout",
    ):
        assert expected in types
    unknown_failure = [r for r in rows if r.event_type == "auth.login.failed" and r.user_id is None]
    assert unknown_failure
    assert all(r.email_hmac and len(r.email_hmac) == 64 for r in unknown_failure)

    secrets = [STRONG_PASSWORD, OTHER_PASSWORD, token, str(session_cookie), email, unknown]
    haystack = caplog.text + json.dumps([list(map(str, r)) for r in rows])
    for secret in secrets:
        assert secret not in haystack


# ------------------------------------------------------------------------------ timing
async def _median_latency(make_request: Callable[[], Awaitable[object]], count: int) -> float:
    durations = []
    for _ in range(count):
        await flush_test_redis()  # keep rate limits out of the measurement
        started = time.perf_counter()
        await make_request()
        durations.append(time.perf_counter() - started)
    return statistics.median(durations)


async def test_existing_and_unknown_emails_take_similar_time() -> None:
    """Statistical, generous bound (plan R7): medians within 20% (one re-measure allowed).

    Uses OWASP-minimum Argon2 parameters so hashing, not noise, dominates.
    """
    settings = integration_settings(
        password_hash_time_cost=2, password_hash_memory_kib=19_456, password_hash_parallelism=1
    )
    app = create_app(settings, configure_logs=False)
    async with running_app(app), client_for(app) as http:
        existing = unique_email()
        await signup(http, existing)

        async def measure() -> list[tuple[float, float]]:
            return [
                (
                    await _median_latency(lambda: login(http, existing, OTHER_PASSWORD), 9),
                    await _median_latency(lambda: login(http, unique_email(), OTHER_PASSWORD), 9),
                ),
                (
                    await _median_latency(lambda: signup(http, existing), 9),
                    await _median_latency(lambda: signup(http, unique_email()), 9),
                ),
            ]

        def within(pairs: list[tuple[float, float]]) -> bool:
            return all(abs(a - b) / max(a, b) <= 0.20 for a, b in pairs)

        pairs = await measure()
        if not within(pairs):
            pairs = await measure()
        assert within(pairs), pairs


async def test_dev_environment_cookie_is_plain_session_without_secure() -> None:
    """V2.4: on http://localhost in dev the cookie is `session` without Secure."""
    settings = integration_settings(
        environment="dev", cookie_secure=False, app_base_url="http://app.test"
    )
    app = create_app(settings, configure_logs=False)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with (
        running_app(app),
        httpx.AsyncClient(
            transport=transport, base_url="http://app.test", headers={"Origin": "http://app.test"}
        ) as http,
    ):
        email = unique_email()
        await signup(http, email)
        response = await login(http, email)
    cookie = response.headers["set-cookie"].lower()
    assert cookie.startswith("session=")
    assert "httponly" in cookie
    assert "samesite=lax" in cookie
    assert "secure" not in cookie
