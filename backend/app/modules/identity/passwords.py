"""Password hashing (Argon2id) and the password policy (plan V2.5, D3/D7).

Policy order: length -> local denylist -> context words -> Pwned Passwords range check.
Only the first five hex characters of the SHA-1 digest ever leave the process; the
plaintext and the full digest are never sent, logged or stored.
"""

import asyncio
import hashlib
import logging
import re
from dataclasses import dataclass
from functools import lru_cache
from importlib import resources
from typing import Literal

import httpx
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.core.config import Settings

logger = logging.getLogger("app.identity.passwords")

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 128
PRODUCT_WORDS = ("jira", "jira-project")
MIN_CONTEXT_WORD_LENGTH = 4
REJECTION_MESSAGE = (
    "This password has appeared in a data breach or is too common. Choose a different password."
)
HIBP_PREFIX_LENGTH = 5
HIBP_USER_AGENT = "jira-project-password-check"
_RANGE_LINE = re.compile(r"(?P<suffix>[0-9A-Fa-f]{35}):(?P<count>\d+)")

BreachStatus = Literal["clean", "breached", "unavailable", "skipped"]


class PasswordRejectedError(ValueError):
    """The password failed policy. The message is safe to show to the user."""


@dataclass(frozen=True, slots=True)
class PasswordCheckResult:
    breach_check: BreachStatus


@lru_cache(maxsize=1)
def common_passwords() -> frozenset[str]:
    """Bundled denylist (see data/README.md for source, license and filtering)."""
    text = resources.files("app.modules.identity").joinpath("data/common_passwords.txt")
    return frozenset(
        line.strip().lower() for line in text.read_text("utf-8").splitlines() if line.strip()
    )


def _context_words(email: str, display_name: str) -> list[str]:
    local_part = email.split("@", 1)[0]
    candidates = [local_part, display_name, *display_name.split(), *PRODUCT_WORDS]
    return [w.lower() for w in candidates if len(w) >= MIN_CONTEXT_WORD_LENGTH]


def check_local_policy(password: str, *, email: str, display_name: str) -> None:
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        raise PasswordRejectedError(
            f"Password must be {MIN_PASSWORD_LENGTH} to {MAX_PASSWORD_LENGTH} characters."
        )
    lowered = password.lower()
    if lowered in common_passwords():
        raise PasswordRejectedError(REJECTION_MESSAGE)
    if any(word in lowered for word in _context_words(email, display_name)):
        raise PasswordRejectedError(
            "Password must not contain your email name, display name or the product name."
        )


class BreachChecker:
    """Pwned Passwords k-anonymity range check with fail-open-to-denylist (D7)."""

    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.enabled = settings.breach_check_mode == "hibp"
        self._timeout = settings.hibp_timeout_ms / 1000
        self._client = client or httpx.AsyncClient(
            base_url=settings.hibp_base_url,
            timeout=httpx.Timeout(self._timeout, connect=min(1.0, self._timeout)),
            follow_redirects=False,
        )
        self.unavailable_total = 0  # exported as a metric once metrics land (M12)

    def _unavailable(self, error_type: str) -> BreachStatus:
        self.unavailable_total += 1
        logger.warning(
            "breach check unavailable; falling back to local denylist",
            extra={"event": "breach_check.unavailable", "error_type": error_type},
        )
        return "unavailable"

    async def aclose(self) -> None:
        await self._client.aclose()

    async def check(self, password: str) -> BreachStatus:
        if not self.enabled:
            return "skipped"
        digest = hashlib.sha1(password.encode(), usedforsecurity=False).hexdigest().upper()
        prefix, suffix = digest[:HIBP_PREFIX_LENGTH], digest[HIBP_PREFIX_LENGTH:]
        try:
            async with asyncio.timeout(self._timeout):
                response = await self._client.get(
                    f"/range/{prefix}",
                    headers={"Add-Padding": "true", "User-Agent": HIBP_USER_AGENT},
                )
            response.raise_for_status()
        except Exception as exc:
            return self._unavailable(type(exc).__name__)
        entries = [_RANGE_LINE.fullmatch(line.strip()) for line in response.text.splitlines()]
        parsed = [m for m in entries if m is not None]
        if not parsed:
            # A 200 that is not a range body (captive portal, misbehaving proxy) must not be
            # mistaken for "clean": treat it as an outage so it is visible in logs/metrics.
            return self._unavailable("InvalidRangeResponse")
        for match in parsed:
            if match["suffix"].upper() == suffix and int(match["count"]) > 0:
                return "breached"
        return "clean"


async def enforce_password_policy(
    password: str, *, email: str, display_name: str, breach_checker: BreachChecker
) -> PasswordCheckResult:
    check_local_policy(password, email=email, display_name=display_name)
    status = await breach_checker.check(password)
    if status == "breached":
        raise PasswordRejectedError(REJECTION_MESSAGE)
    return PasswordCheckResult(breach_check=status)


class PasswordHashing:
    def __init__(self, settings: Settings) -> None:
        self._hasher = PasswordHasher(
            time_cost=settings.password_hash_time_cost,
            memory_cost=settings.password_hash_memory_kib,
            parallelism=settings.password_hash_parallelism,
        )
        # Verified against when the email is unknown, so both paths cost the same.
        self._dummy_hash = self._hasher.hash("dummy-password-for-timing-equalisation")

    async def hash(self, password: str) -> str:
        return await asyncio.to_thread(self._hasher.hash, password)

    async def verify(self, stored_hash: str | None, password: str) -> bool:
        target = stored_hash or self._dummy_hash
        try:
            ok = await asyncio.to_thread(self._hasher.verify, target, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
        return bool(ok) and stored_hash is not None

    def needs_rehash(self, stored_hash: str) -> bool:
        return self._hasher.check_needs_rehash(stored_hash)
