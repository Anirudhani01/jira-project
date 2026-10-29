import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest
from pydantic import SecretStr
from starlette.requests import Request

from app.core.logging import redact
from app.core.rate_limit import LOGIN_PER_IP_EMAIL, SIGNUP_PER_IP, RateLimiter
from app.core.security import KeyPurpose, SecretKeys, hash_token, new_session_token
from app.main import create_redis
from app.modules.identity.deps import client_info
from app.modules.identity.service import reserve_rate_limit
from app.modules.security_events.service import ClientInfo, _values
from tests.conftest import make_settings

BACKEND = Path(__file__).resolve().parents[2]


def keys() -> SecretKeys:
    return SecretKeys(SecretStr("k" * 40))


def test_session_tokens_are_random_and_hashed() -> None:
    first, second = new_session_token(), new_session_token()
    assert first != second
    assert len(first) >= 43
    assert hash_token(first) != hash_token(second)
    assert len(hash_token(first)) == 32


def test_derived_keys_are_domain_separated() -> None:
    k = keys()
    assert k.mac(KeyPurpose.CSRF, "x") != k.mac(KeyPurpose.EMAIL_HMAC, "x")
    assert k.csrf_matches("token", k.csrf_token("token"))
    assert not k.csrf_matches("other-token", k.csrf_token("token"))


def test_email_hmac_is_normalized_and_not_reversible() -> None:
    k = keys()
    assert k.email_hmac(" Ann@Example.com ") == k.email_hmac("ann@example.com")
    assert "ann" not in k.email_hmac("ann@example.com")
    assert SecretKeys(SecretStr("z" * 40)).email_hmac("ann@example.com") != k.email_hmac(
        "ann@example.com"
    )


async def test_rate_limiter_can_be_disabled() -> None:
    redis = create_redis(make_settings())
    limiter = RateLimiter(redis, keys(), enabled=False)
    try:
        for _ in range(50):
            assert not (await limiter.acquire(LOGIN_PER_IP_EMAIL, "1.2.3.4|a@x.io")).blocked
    finally:
        await redis.aclose()


async def test_reserve_rate_limit_is_noop_when_limiter_disabled() -> None:
    redis = create_redis(make_settings())
    limiter = RateLimiter(redis, keys(), enabled=False)
    services = MagicMock()
    services.limiter = limiter
    try:
        for _ in range(10):
            assert (
                await reserve_rate_limit(
                    services,
                    SIGNUP_PER_IP,
                    "127.0.0.1",
                    ClientInfo(ip="127.0.0.1", user_agent=None),
                )
            ) is None
    finally:
        await redis.aclose()


async def test_rate_limiter_falls_back_in_process_when_redis_down() -> None:
    settings = make_settings()  # unreachable Redis (port 1)
    redis = create_redis(settings)
    limiter = RateLimiter(redis, keys())
    subject = "1.2.3.4|a@x.io"
    try:
        held = [await limiter.acquire(LOGIN_PER_IP_EMAIL, subject) for _ in range(5)]
        assert all(not a.blocked for a in held)
        blocked = await limiter.acquire(LOGIN_PER_IP_EMAIL, subject)
        assert blocked.blocked
        assert blocked.reservation is None
        assert 0 < (blocked.retry_after or 0) <= LOGIN_PER_IP_EMAIL.window_seconds
        assert not (await limiter.acquire(LOGIN_PER_IP_EMAIL, "5.6.7.8|a@x.io")).blocked
        # Releasing a reservation (e.g. a successful login) frees exactly one slot.
        await limiter.release(held[0].reservation)
        assert not (await limiter.acquire(LOGIN_PER_IP_EMAIL, subject)).blocked
        assert (await limiter.acquire(LOGIN_PER_IP_EMAIL, subject)).blocked
    finally:
        await redis.aclose()


async def test_concurrent_acquires_never_exceed_limit_in_fallback() -> None:
    """Regression (review F1): parallel attempts cannot all pass a check-then-act gap."""
    redis = create_redis(make_settings())
    limiter = RateLimiter(redis, keys())
    try:
        results = await asyncio.gather(
            *(limiter.acquire(LOGIN_PER_IP_EMAIL, "9.9.9.9|b@x.io") for _ in range(25))
        )
        assert sum(not r.blocked for r in results) == LOGIN_PER_IP_EMAIL.limit
    finally:
        await redis.aclose()


def test_redaction_masks_email_addresses() -> None:
    """Regression (review F2): DB DETAIL lines can carry emails into tracebacks."""
    text_ = "duplicate key value violates unique constraint DETAIL: Key (email)=(ann@example.com)"
    assert "ann@example.com" not in redact(text_)
    assert "[EMAIL]" in redact(text_)


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("203.0.113.9", "203.0.113.9"),
        ("2001:db8::1", "2001:db8::1"),
        ("not-an-ip", None),
        ("1.2.3.4, 5.6.7.8", None),
        ("", None),
    ],
)
def test_client_ip_accepts_only_literal_addresses(host: str, expected: str | None) -> None:
    """Regression (review F3): non-IP peers are never used as keys or stored as INET."""
    scope: dict[str, Any] = {
        "type": "http",
        "headers": [],
        "client": (host, 1234) if host else None,
    }
    assert client_info(Request(scope)).ip == expected


def test_nginx_overwrites_forwarded_for() -> None:
    """Regression (review F3): appending lets clients choose the leftmost (trusted) hop."""
    conf = (BACKEND.parent / "frontend" / "nginx" / "default.conf").read_text()
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in conf
    assert "$proxy_add_x_forwarded_for" not in conf


def test_security_event_metadata_is_allowlisted() -> None:
    client = ClientInfo(ip="127.0.0.1", user_agent="ua")
    with pytest.raises(ValueError, match="not allowlisted"):
        _values("auth.login.failed", "failure", client, metadata={"password": "x"})
    with pytest.raises(ValueError, match="unknown security event"):
        _values("auth.made.up", "info", client)
    values = _values("auth.signup.requested", "info", client, metadata={"breach_check": "clean"})
    assert values["metadata"] == {"breach_check": "clean"}
