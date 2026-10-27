"""Password policy and Pwned Passwords range check (plan V2.5, D3/D7). No live network."""

import hashlib
import logging

import httpx
import pytest

from app.modules.identity.passwords import (
    REJECTION_MESSAGE,
    BreachChecker,
    PasswordHashing,
    PasswordRejectedError,
    check_local_policy,
    common_passwords,
    enforce_password_policy,
)
from tests.conftest import make_settings

GOOD = "Velvet-Harbor-Lantern-93"


def sha1_parts(password: str) -> tuple[str, str]:
    digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
    return digest[:5], digest[5:]


def checker(handler: httpx.MockTransport | None = None) -> BreachChecker:
    settings = make_settings(breach_check_mode="hibp", hibp_timeout_ms=500)
    transport = handler or httpx.MockTransport(lambda _: httpx.Response(200, text=range_body()))
    client = httpx.AsyncClient(base_url="https://hibp.test", transport=transport)
    return BreachChecker(settings, client=client)


def range_body(*suffixes: tuple[str, int]) -> str:
    padding = [("0" * 35, 0), ("F" * 35, 0)]
    return "\r\n".join(f"{s}:{c}" for s, c in [*suffixes, *padding])


# ------------------------------------------------------------------------ local policy
@pytest.mark.parametrize("password", ["short", "x" * 11, "y" * 129])
def test_length_bounds(password: str) -> None:
    with pytest.raises(PasswordRejectedError, match="12 to 128"):
        check_local_policy(password, email="a@example.com", display_name="Ann")


def test_denylisted_password_rejected_case_insensitively() -> None:
    entry = next(iter(common_passwords()))
    with pytest.raises(PasswordRejectedError, match="data breach or is too common"):
        check_local_policy(entry.upper(), email="a@example.com", display_name="Ann")


def test_denylist_loaded_and_only_policy_length_entries() -> None:
    entries = common_passwords()
    assert len(entries) > 100
    assert all(12 <= len(e) <= 128 for e in entries)


@pytest.mark.parametrize(
    "password",
    ["my-ravindra-password-77", "Kavya Rao 2026 strong!", "my-jira-account-2026"],
)
def test_context_words_rejected(password: str) -> None:
    with pytest.raises(PasswordRejectedError, match="must not contain"):
        check_local_policy(password, email="ravindra@example.com", display_name="Kavya Rao")


def test_acceptable_password_passes_local_policy() -> None:
    check_local_policy(GOOD, email="ravindra@example.com", display_name="Kavya Rao")


# ---------------------------------------------------------------------- breach checker
async def test_breached_password_rejected() -> None:
    _, suffix = sha1_parts(GOOD)
    transport = httpx.MockTransport(lambda _: httpx.Response(200, text=range_body((suffix, 42))))
    with pytest.raises(PasswordRejectedError) as excinfo:
        await enforce_password_policy(
            GOOD, email="a@example.com", display_name="Ann", breach_checker=checker(transport)
        )
    assert str(excinfo.value) == REJECTION_MESSAGE


async def test_clean_password_accepted() -> None:
    result = await enforce_password_policy(
        GOOD, email="a@example.com", display_name="Ann", breach_checker=checker()
    )
    assert result.breach_check == "clean"


async def test_padding_entries_with_zero_count_are_not_breaches() -> None:
    _, suffix = sha1_parts(GOOD)
    transport = httpx.MockTransport(lambda _: httpx.Response(200, text=range_body((suffix, 0))))
    status = await checker(transport).check(GOOD)
    assert status == "clean"


async def test_denylisted_password_rejected_even_if_service_says_clean() -> None:
    entry = next(iter(common_passwords()))
    with pytest.raises(PasswordRejectedError):
        await enforce_password_policy(
            entry, email="a@example.com", display_name="Ann", breach_checker=checker()
        )


async def test_request_sends_only_prefix_with_padding_header() -> None:
    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, text=range_body())

    await checker(httpx.MockTransport(handler)).check(GOOD)
    prefix, suffix = sha1_parts(GOOD)
    (request,) = seen
    assert request.url.path == f"/range/{prefix}"
    assert len(prefix) == 5
    assert request.headers["Add-Padding"] == "true"
    assert request.headers["User-Agent"]
    raw = str(request.url) + str(dict(request.headers)) + request.content.decode()
    assert GOOD not in raw
    assert suffix not in raw


def _raise_timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("timeout", request=request)


def _raise_connect(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("refused", request=request)


@pytest.mark.parametrize(
    "transport",
    [
        httpx.MockTransport(_raise_timeout),
        httpx.MockTransport(_raise_connect),
        httpx.MockTransport(lambda _: httpx.Response(503)),
        httpx.MockTransport(lambda _: httpx.Response(429)),
    ],
)
async def test_outage_fails_open_to_local_denylist(
    transport: httpx.MockTransport, caplog: pytest.LogCaptureFixture
) -> None:
    breach_checker = checker(transport)
    with caplog.at_level(logging.WARNING):
        result = await enforce_password_policy(
            GOOD, email="a@example.com", display_name="Ann", breach_checker=breach_checker
        )
    assert result.breach_check == "unavailable"
    assert breach_checker.unavailable_total == 1
    assert any(getattr(r, "event", None) == "breach_check.unavailable" for r in caplog.records)
    assert GOOD not in caplog.text


async def test_outage_still_rejects_denylisted_password() -> None:
    entry = next(iter(common_passwords()))
    with pytest.raises(PasswordRejectedError):
        await enforce_password_policy(
            entry,
            email="a@example.com",
            display_name="Ann",
            breach_checker=checker(httpx.MockTransport(lambda _: httpx.Response(503))),
        )


async def test_local_only_mode_skips_network() -> None:
    settings = make_settings(breach_check_mode="local_only")
    called = False

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(200)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    assert await BreachChecker(settings, client=client).check(GOOD) == "skipped"
    assert not called


# --------------------------------------------------------------------------- hashing
async def test_argon2id_hash_and_verify() -> None:
    hashing = PasswordHashing(make_settings())
    stored = await hashing.hash(GOOD)
    assert stored.startswith("$argon2id$")
    assert GOOD not in stored
    assert await hashing.verify(stored, GOOD)
    assert not await hashing.verify(stored, GOOD + "x")


async def test_unknown_user_verify_runs_dummy_hash_and_fails() -> None:
    hashing = PasswordHashing(make_settings())
    assert not await hashing.verify(None, GOOD)
    assert not await hashing.verify("not-a-hash", GOOD)


async def test_rehash_needed_when_parameters_change() -> None:
    weak = PasswordHashing(make_settings())
    stored = await weak.hash(GOOD)
    stronger = PasswordHashing(make_settings(password_hash_time_cost=2))
    assert stronger.needs_rehash(stored)
    assert not weak.needs_rehash(stored)


@pytest.mark.parametrize(
    "body", ["", "<html><body>Sign in to the Wi-Fi</body></html>", "not:a:range\nbody"]
)
async def test_ok_response_without_range_lines_counts_as_unavailable(
    body: str, caplog: pytest.LogCaptureFixture
) -> None:
    """Regression (review F4): a 200 that is not a range body must not read as 'clean'."""
    breach_checker = checker(httpx.MockTransport(lambda _: httpx.Response(200, text=body)))
    with caplog.at_level(logging.WARNING):
        assert await breach_checker.check(GOOD) == "unavailable"
    assert breach_checker.unavailable_total == 1
    assert any(getattr(r, "error_type", None) == "InvalidRangeResponse" for r in caplog.records)


async def test_lowercase_range_suffix_still_matches() -> None:
    _, suffix = sha1_parts(GOOD)
    body = range_body((suffix.lower(), 3))
    breach_checker = checker(httpx.MockTransport(lambda _: httpx.Response(200, text=body)))
    assert await breach_checker.check(GOOD) == "breached"
