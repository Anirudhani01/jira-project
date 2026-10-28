"""M2 email flows end to end: API -> outbox -> worker -> Mailpit -> token -> API.

Covers plan R2 (M2), R7-M2, V2.9-M2: the three signup emails behind identical
responses; fragment-based single-use, hashed, expiring tokens (<= 3 active); verification
rotates the current session and revokes the others; reset revokes every session, sets no
session and is screened by the password policy; outbox payloads hold identifiers only.
"""

import hashlib
import json
import logging
import statistics
import time
from collections.abc import AsyncIterator, Callable

import httpx
import pytest

from app.core.mailer import EmailDeliveryDisabledError, OutgoingEmail
from app.db.engine import create_db_engine
from app.db.session import create_sessionmaker
from app.main import create_app
from app.modules.identity.emails import (
    TOPIC_PASSWORD_RESET,
    TOPIC_VERIFY,
    EmailJob,
    handle_email_job,
)
from app.modules.identity.passwords import BreachChecker, BreachStatus
from app.modules.outbox.service import TOPIC_PAYLOAD_KEYS
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
from tests.integration.email_support import (
    mailpit_messages,
    run_worker,
    token_from,
    worker_settings,
)
from tests.integration.test_auth_signup_login import comparable

COOKIE = "__Host-session"
NEW_PASSWORD = "Amber-Glacier-Orchid-71"  # gitleaks:allow (synthetic test password)


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def http() -> AsyncIterator[httpx.AsyncClient]:
    async with auth_client() as client:
        yield client


async def verify(http: httpx.AsyncClient, token: str, **headers: str) -> httpx.Response:
    return await http.post("/api/v1/auth/verify-email", json={"token": token}, headers=headers)


async def request_reset(http: httpx.AsyncClient, email: str) -> httpx.Response:
    return await http.post("/api/v1/auth/password-reset/request", json={"email": email})


async def confirm_reset(http: httpx.AsyncClient, token: str, password: str) -> httpx.Response:
    return await http.post(
        "/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": password}
    )


async def session_user(http: httpx.AsyncClient) -> dict[str, object] | None:
    response = await http.get("/api/v1/auth/session")
    return response.json()["user"] if response.status_code == 200 else None


async def signup_and_get_verify_token(http: httpx.AsyncClient, email: str) -> str:
    assert (await signup(http, email)).status_code == 202
    await run_worker()
    [message] = await mailpit_messages(email, expected=1)
    return token_from(message, "/verify-email")


# ------------------------------------------------------------------------ signup emails
async def test_three_signup_branches_send_distinct_emails_behind_identical_responses(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    new = await signup(http, email)
    await run_worker()
    unverified_again = await signup(http, email, OTHER_PASSWORD)
    await run_worker()
    await superuser_sql("UPDATE users SET email_verified_at = now() WHERE email = :e", e=email)
    verified_again = await signup(http, email, OTHER_PASSWORD)
    await run_worker()

    assert comparable(new) == comparable(unverified_again) == comparable(verified_again)
    first, second, third = await mailpit_messages(email, expected=3)
    assert first["Subject"] == second["Subject"] == "Verify your email address"
    assert token_from(first, "/verify-email") != token_from(second, "/verify-email")
    assert third["Subject"] == "Sign-up attempt with your email address"
    assert "#token=" not in third["Text"]
    assert "/forgot-password" in third["Text"]
    # The duplicate attempts changed nothing about the original account.
    assert (await login(http, email, STRONG_PASSWORD)).status_code == 204


async def test_signup_emails_are_limited_per_address_without_changing_the_response(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    responses = [await signup(http, email) for _ in range(4)]
    await run_worker()
    assert all(comparable(r) == comparable(responses[0]) for r in responses)
    assert len(await mailpit_messages(email, expected=3)) == 3


async def test_email_links_carry_the_token_in_the_fragment_only(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    await run_worker()
    [message] = await mailpit_messages(email, expected=1)
    assert "https://app.test/verify-email#token=" in message["Text"]
    assert "?token=" not in message["Text"]
    assert message["MessageID"].startswith("outbox-")


# -------------------------------------------------------------------- email verification
async def test_verification_without_session_verifies_and_revokes_all_sessions(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    token = await signup_and_get_verify_token(http, email)
    async with auth_client() as other:
        await login(other, email)
        assert (await session_user(other)) is not None
        response = await verify(http, token)  # `http` has no session
        assert response.status_code == 204
        assert "set-cookie" not in response.headers
        assert await session_user(other) is None  # pre-existing sessions revoked
    await login(http, email)
    assert (await session_user(http))["email_verified"] is True  # type: ignore[index]


async def test_verification_rotates_current_session_and_revokes_others(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    token = await signup_and_get_verify_token(http, email)
    await login(http, email)
    old_cookie = http.cookies[COOKIE]
    async with auth_client() as other:
        await login(other, email)
        response = await verify(http, token, **{"X-CSRF-Token": await csrf(http)})
        assert response.status_code == 204
        new_cookie = response.cookies[COOKIE]
        assert new_cookie
        assert new_cookie != old_cookie
        assert (await session_user(http))["email_verified"] is True  # type: ignore[index]
        assert await session_user(other) is None
    async with auth_client() as replay:
        replay.cookies.set(COOKIE, old_cookie)
        assert await session_user(replay) is None


async def test_verification_with_session_requires_csrf_token(http: httpx.AsyncClient) -> None:
    email = unique_email()
    token = await signup_and_get_verify_token(http, email)
    await login(http, email)
    response = await verify(http, token)
    assert response.status_code == 403
    assert response.json()["code"] == "csrf_failed"
    assert (await session_user(http))["email_verified"] is False  # type: ignore[index]


async def test_verification_with_another_users_session_does_not_rotate_it(
    http: httpx.AsyncClient,
) -> None:
    owner = unique_email()
    token = await signup_and_get_verify_token(http, owner)
    bystander = unique_email()
    await signup(http, bystander)
    await login(http, bystander)
    response = await verify(http, token, **{"X-CSRF-Token": await csrf(http)})
    assert response.status_code == 204
    assert "set-cookie" not in response.headers
    assert (await session_user(http))["email"] == bystander  # type: ignore[index]


async def test_verification_token_is_single_use(http: httpx.AsyncClient) -> None:
    token = await signup_and_get_verify_token(http, unique_email())
    assert (await verify(http, token)).status_code == 204
    again = await verify(http, token)
    assert again.status_code == 400
    assert again.json()["code"] == "invalid_token"


@pytest.mark.parametrize(
    "token",
    ["A" * 43, "not a token!", "short"],
)
async def test_unknown_or_malformed_tokens_are_rejected(
    http: httpx.AsyncClient, token: str
) -> None:
    response = await verify(http, token)
    assert response.status_code in (400, 422)
    assert "set-cookie" not in response.headers


async def test_expired_verification_token_is_rejected(http: httpx.AsyncClient) -> None:
    email = unique_email()
    token = await signup_and_get_verify_token(http, email)
    await superuser_sql(
        "UPDATE user_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = :h",
        h=hashlib.sha256(token.encode()).digest(),
    )
    response = await verify(http, token)
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_token"


async def test_tokens_are_stored_hashed_with_configured_lifetimes(http: httpx.AsyncClient) -> None:
    email = unique_email()
    token = await signup_and_get_verify_token(http, email)
    await request_reset(http, email)
    await run_worker()
    reset_token = token_from((await mailpit_messages(email, expected=2))[-1], "/reset-password")
    rows = await superuser_sql(
        "SELECT t.purpose, t.token_hash, extract(epoch FROM t.expires_at - t.created_at) AS ttl "
        "FROM user_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = :e ORDER BY t.purpose",
        e=email,
    )
    by_purpose = {r.purpose: r for r in rows}
    assert bytes(by_purpose["verify_email"].token_hash) == hashlib.sha256(token.encode()).digest()
    assert (
        bytes(by_purpose["reset_password"].token_hash)
        == hashlib.sha256(reset_token.encode()).digest()
    )
    assert round(by_purpose["verify_email"].ttl) == 24 * 3600
    assert round(by_purpose["reset_password"].ttl) == 3600
    dump = json.dumps([[str(v) for v in r] for r in rows])
    assert token not in dump
    assert reset_token not in dump


async def test_at_most_three_tokens_stay_active_per_purpose(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    [row] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
    for _ in range(3):  # three more verification emails (bypassing the per-address limit)
        await superuser_sql(
            "INSERT INTO outbox (topic, payload) VALUES ('email.verify', "
            "jsonb_build_object('user_id', CAST(:u AS text)))",
            u=str(row.id),
        )
    await run_worker()
    tokens = [token_from(m, "/verify-email") for m in await mailpit_messages(email, expected=4)]
    assert len(set(tokens)) == 4
    [active] = await superuser_sql(
        "SELECT count(*) AS n FROM user_tokens WHERE user_id = :u AND used_at IS NULL "
        "AND invalidated_at IS NULL AND expires_at > now()",
        u=row.id,
    )
    assert active.n == 3
    assert (await verify(http, tokens[0])).status_code == 400  # oldest was invalidated
    assert (await verify(http, tokens[1])).status_code == 204  # earlier duplicates still work
    # Verification invalidates the remaining verification tokens.
    assert (await verify(http, tokens[3])).status_code == 400


async def test_verified_user_gets_no_new_verification_token(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    await superuser_sql("UPDATE users SET email_verified_at = now() WHERE email = :e", e=email)
    await run_worker()
    assert await mailpit_messages(email) == []
    rows = await superuser_sql(
        "SELECT 1 FROM user_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = :e", e=email
    )
    assert rows == []


# ------------------------------------------------------------------------ password reset
async def test_reset_request_is_identical_for_known_and_unknown_emails(
    http: httpx.AsyncClient,
) -> None:
    known, unknown = unique_email(), unique_email()
    await signup(http, known)
    await run_worker()
    known_response = await request_reset(http, known)
    unknown_response = await request_reset(http, unknown)
    assert known_response.status_code == 202
    assert comparable(known_response) == comparable(unknown_response)
    assert "set-cookie" not in known_response.headers
    await run_worker()
    assert [m["Subject"] for m in await mailpit_messages(known, expected=2)][-1] == (
        "Reset your password"
    )
    assert await mailpit_messages(unknown) == []


async def test_reset_revokes_every_session_and_does_not_sign_in(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    await login(http, email)
    async with auth_client() as other:
        await login(other, email)
        await request_reset(http, email)
        await run_worker()
        token = token_from((await mailpit_messages(email, expected=2))[-1], "/reset-password")
        async with auth_client() as anonymous:
            response = await confirm_reset(anonymous, token, NEW_PASSWORD)
        assert response.status_code == 204
        assert COOKIE not in response.cookies or not response.cookies[COOKIE]
        assert await session_user(http) is None
        assert await session_user(other) is None
    assert (await login(http, email, STRONG_PASSWORD)).status_code == 401
    await flush_test_redis()
    assert (await login(http, email, NEW_PASSWORD)).status_code == 204
    # Proving control of the mailbox verifies the address (pre-hijack defense, plan R1 #2).
    assert (await session_user(http))["email_verified"] is True  # type: ignore[index]
    assert (await confirm_reset(http, token, OTHER_PASSWORD)).status_code == 400


class FlagsNewPassword(BreachChecker):
    """Reports NEW_PASSWORD as breached (no network)."""

    async def check(self, password: str) -> BreachStatus:
        return "breached" if password == NEW_PASSWORD else "clean"


async def test_reset_rejects_breached_password_and_keeps_token_usable() -> None:
    settings = integration_settings()
    app = create_app(settings, configure_logs=False, breach_checker=FlagsNewPassword(settings))
    email = unique_email()
    async with running_app(app), client_for(app) as http:
        await signup(http, email)
        await request_reset(http, email)
        await run_worker()
        token = token_from((await mailpit_messages(email, expected=2))[-1], "/reset-password")
        rejected = await confirm_reset(http, token, NEW_PASSWORD)
        assert rejected.status_code == 422
        assert rejected.json()["code"] == "password_rejected"
        assert rejected.json()["errors"][0]["field"] == "body.new_password"
        weak = await confirm_reset(http, token, "short")
        assert weak.status_code == 422
        assert (await confirm_reset(http, token, OTHER_PASSWORD)).status_code == 204


async def test_reset_token_cannot_verify_email_and_vice_versa(http: httpx.AsyncClient) -> None:
    email = unique_email()
    verify_token = await signup_and_get_verify_token(http, email)
    assert (await confirm_reset(http, verify_token, NEW_PASSWORD)).status_code == 400
    await request_reset(http, email)
    await run_worker()
    reset_token = token_from((await mailpit_messages(email, expected=2))[-1], "/reset-password")
    assert (await verify(http, reset_token)).status_code == 400


async def test_reset_requests_are_limited_per_address_silently_and_per_ip_with_429(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    await signup(http, email)
    responses = [await request_reset(http, email) for _ in range(4)]
    assert {r.status_code for r in responses} == {202}
    await run_worker()
    resets = [m for m in await mailpit_messages(email, expected=4) if "Reset" in m["Subject"]]
    assert len(resets) == 3
    for _ in range(16):  # 20 per IP per hour in total
        assert (await request_reset(http, unique_email())).status_code == 202
    limited = await request_reset(http, unique_email())
    assert limited.status_code == 429
    assert "retry-after" in limited.headers


async def test_repeated_invalid_tokens_are_rate_limited(http: httpx.AsyncClient) -> None:
    for _ in range(30):
        assert (await verify(http, "B" * 43)).status_code == 400
    assert (await verify(http, "B" * 43)).status_code == 429


# ----------------------------------------------------------------------------- secrets
async def test_outbox_payloads_and_logs_contain_no_tokens_or_passwords(
    http: httpx.AsyncClient, caplog: pytest.LogCaptureFixture
) -> None:
    email = unique_email()
    with caplog.at_level(logging.DEBUG):
        token = await signup_and_get_verify_token(http, email)
        await verify(http, token)
        await request_reset(http, email)
        await request_reset(http, unique_email())
        await run_worker()
        reset_token = token_from((await mailpit_messages(email, expected=2))[-1], "/reset-password")
        await confirm_reset(http, reset_token, NEW_PASSWORD)

    payloads = await superuser_sql("SELECT topic, payload::text AS payload FROM outbox")
    for row in payloads:
        # Identifiers only, exactly the keys allowlisted for the topic.
        assert set(json.loads(row.payload)) <= TOPIC_PAYLOAD_KEYS.get(row.topic, {"user_id"})
    events = await superuser_sql(
        "SELECT metadata::text AS md, reason FROM security.platform_security_events "
        "WHERE occurred_at > now() - interval '1 minute'"
    )
    haystack = (
        caplog.text
        + json.dumps([r.payload for r in payloads])
        + json.dumps([[r.md, r.reason] for r in events])
    )
    for secret in (token, reset_token, STRONG_PASSWORD, NEW_PASSWORD, email):
        assert secret not in haystack


async def test_delivery_disabled_mints_no_token_and_sends_nothing(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    await run_worker(email_delivery_enabled=False, smtp_host=None, email_from=None)
    assert await mailpit_messages(email) == []
    rows = await superuser_sql(
        "SELECT o.processed_at FROM outbox o JOIN users u ON o.payload->>'user_id' = u.id::text "
        "WHERE u.email = :e",
        e=email,
    )
    assert len(rows) == 1
    assert rows[0].processed_at is not None
    tokens = await superuser_sql(
        "SELECT 1 FROM user_tokens t JOIN users u ON u.id = t.user_id WHERE u.email = :e", e=email
    )
    assert tokens == []


# ------------------------------------------------------------ M2 review regressions
class FailingMailer:
    async def send(self, email: OutgoingEmail) -> None:
        raise ConnectionError("smtp unavailable")


async def usable_tokens(email: str) -> int:
    [row] = await superuser_sql(
        "SELECT count(*) AS n FROM user_tokens t JOIN users u ON u.id = t.user_id "
        "WHERE u.email = :e AND t.used_at IS NULL AND t.invalidated_at IS NULL "
        "AND t.expires_at > now()",
        e=email,
    )
    return int(row.n)


async def test_failed_sends_never_push_out_a_delivered_link(http: httpx.AsyncClient) -> None:
    """Regression: undelivered tokens counted toward the cap of 3, so repeated send
    failures invalidated the only link the user had actually received."""
    email = unique_email()
    delivered = await signup_and_get_verify_token(http, email)
    [user] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
    [job] = await superuser_sql(
        "INSERT INTO outbox (topic, payload) VALUES ('email.verify', "
        "jsonb_build_object('user_id', CAST(:u AS text))) RETURNING id",
        u=str(user.id),
    )
    for _ in range(4):
        await superuser_sql("UPDATE outbox SET available_at = now() WHERE id = :id", id=job.id)
        await run_worker(mailer=FailingMailer())
    assert await usable_tokens(email) == 1
    assert (await verify(http, delivered)).status_code == 204


async def test_disabled_delivery_never_mints_even_when_handler_is_called_directly() -> None:
    email = unique_email()
    async with auth_client() as http:
        await signup(http, email)
    [user] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
    settings = worker_settings(email_delivery_enabled=False, smtp_host=None, email_from=None)
    engine = create_db_engine(settings, url=settings.worker_database_url)
    try:
        for topic in (TOPIC_VERIFY, TOPIC_PASSWORD_RESET):
            with pytest.raises(EmailDeliveryDisabledError):
                await handle_email_job(
                    EmailJob(job_id=1, topic=topic, user_id=user.id),
                    settings=settings,
                    sessionmaker=create_sessionmaker(engine),
                    mailer=FailingMailer(),
                )
    finally:
        await engine.dispose()
    assert await usable_tokens(email) == 0


async def test_reset_request_refuses_identically_while_delivery_is_disabled() -> None:
    known, unknown = unique_email(), unique_email()
    async with auth_client(email_delivery_enabled=False, smtp_host=None, email_from=None) as http:
        await signup(http, known)
        known_response = await request_reset(http, known)
        unknown_response = await request_reset(http, unknown)
    assert known_response.status_code == 503
    assert known_response.json()["code"] == "email_unavailable"
    assert comparable(known_response) == comparable(unknown_response)
    rows = await superuser_sql(
        "SELECT 1 FROM outbox o JOIN users u ON o.payload->>'user_id' = u.id::text "
        "WHERE u.email = :e AND o.topic = 'email.password_reset'",
        e=known,
    )
    assert rows == []


async def test_expired_reset_token_is_rejected(http: httpx.AsyncClient) -> None:
    email = unique_email()
    await signup(http, email)
    await request_reset(http, email)
    await run_worker()
    token = token_from((await mailpit_messages(email, expected=2))[-1], "/reset-password")
    await superuser_sql(
        "UPDATE user_tokens SET expires_at = now() - interval '1 second' WHERE token_hash = :h",
        h=hashlib.sha256(token.encode()).digest(),
    )
    response = await confirm_reset(http, token, NEW_PASSWORD)
    assert response.status_code == 400
    assert response.json()["code"] == "invalid_token"
    assert (await login(http, email, STRONG_PASSWORD)).status_code == 204


async def test_disabled_account_gets_the_unknown_address_treatment(
    http: httpx.AsyncClient,
) -> None:
    email = unique_email()
    await signup(http, email)
    await run_worker()
    await superuser_sql("UPDATE users SET status = 'disabled' WHERE email = :e", e=email)
    assert (await request_reset(http, email)).status_code == 202
    await run_worker()
    assert [m["Subject"] for m in await mailpit_messages(email, expected=1)] == [
        "Verify your email address"
    ]


async def test_reset_request_takes_similar_time_for_known_and_unknown_emails() -> None:
    """Same statistical bound as M1 (plan R7): medians within 20%, one re-measure."""
    async with auth_client() as http:
        known = unique_email()
        await signup(http, known)

        async def median(email_for: Callable[[], str]) -> float:
            durations = []
            for _ in range(9):
                await flush_test_redis()
                started = time.perf_counter()
                await request_reset(http, email_for())
                durations.append(time.perf_counter() - started)
            return statistics.median(durations)

        def similar(a: float, b: float) -> bool:
            return abs(a - b) / max(a, b) <= 0.20

        known_t, unknown_t = await median(lambda: known), await median(unique_email)
        if not similar(known_t, unknown_t):
            known_t, unknown_t = await median(lambda: known), await median(unique_email)
        assert similar(known_t, unknown_t), (known_t, unknown_t)
