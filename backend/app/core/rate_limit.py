"""Sliding-window rate limiting (plan §4.5, R5).

Redis is the shared store. If Redis is unavailable, auth endpoints fall back to a
per-process sliding window with the same limits ("degraded-closed"): weaker across
instances, but brute force stays bounded. Subjects (IPs, emails) are keyed through an
HMAC, so raw addresses never appear in Redis.
"""

import logging
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Final, cast

from redis.asyncio import Redis

from app.core.security import KeyPurpose, SecretKeys

logger = logging.getLogger("app.rate_limit")


@dataclass(frozen=True, slots=True)
class RateLimit:
    name: str
    limit: int
    window_seconds: int


# Plan §4.5. Counted on failures for login, on every request for signup.
LOGIN_PER_IP_EMAIL: Final = RateLimit("login-ip-email", 5, 60)
LOGIN_PER_IP: Final = RateLimit("login-ip", 30, 60)
SIGNUP_PER_IP: Final = RateLimit("signup-ip", 5, 3600)
# Guards current-password guessing with a stolen session.
PASSWORD_CHANGE_PER_USER: Final = RateLimit("password-change-user", 5, 900)
# M2 (plan §4.5): emails per address are limited silently (the response never changes, so
# the limit reveals nothing); per-IP limits answer 429.
SIGNUP_EMAIL_PER_ADDRESS: Final = RateLimit("signup-email-address", 3, 3600)
PASSWORD_RESET_PER_ADDRESS: Final = RateLimit("password-reset-address", 3, 3600)
PASSWORD_RESET_PER_IP: Final = RateLimit("password-reset-ip", 20, 3600)
# Invalid verification/reset token submissions (counted on failure only).
TOKEN_FAILURES_PER_IP: Final = RateLimit("token-failures-ip", 30, 3600)
# M3: organization creation attempts per user (every attempt counts).
ORG_CREATE_PER_USER: Final = RateLimit("org-create-user", 10, 3600)

# Atomic check-and-reserve: concurrent requests cannot all pass the check before any
# of them is counted (the original check-then-hit design allowed parallel bursts).
_ACQUIRE_SCRIPT = """
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1] - ARGV[2])
if redis.call('ZCARD', KEYS[1]) >= tonumber(ARGV[3]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return tonumber(oldest[2]) + tonumber(ARGV[2]) - tonumber(ARGV[1])
end
redis.call('ZADD', KEYS[1], ARGV[1], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return -1
"""


@dataclass(frozen=True, slots=True)
class Reservation:
    """A slot taken in a rate-limit window; release it to not count the attempt."""

    key: str
    member: str
    local: bool


@dataclass(frozen=True, slots=True)
class Acquired:
    reservation: Reservation | None
    retry_after: float | None  # set when blocked

    @property
    def blocked(self) -> bool:
        return self.retry_after is not None


class _LocalWindow:
    """Per-process fallback with bounded memory (LRU over keys)."""

    def __init__(self, max_keys: int) -> None:
        self._hits: OrderedDict[str, OrderedDict[str, float]] = OrderedDict()
        self._max_keys = max_keys

    def acquire(self, key: str, member: str, rule: RateLimit, now: float) -> float | None:
        hits = self._hits.setdefault(key, OrderedDict())
        self._hits.move_to_end(key)
        for stale in [m for m, at in hits.items() if at <= now - rule.window_seconds]:
            del hits[stale]
        if len(hits) >= rule.limit:
            return min(hits.values()) + rule.window_seconds - now
        hits[member] = now
        while len(self._hits) > self._max_keys:
            self._hits.popitem(last=False)
        return None

    def release(self, key: str, member: str) -> None:
        hits = self._hits.get(key)
        if hits is not None:
            hits.pop(member, None)


class RateLimiter:
    def __init__(self, redis: Redis, keys: SecretKeys, *, fallback_max_keys: int = 100_000):
        self._redis = redis
        self._keys = keys
        self._local = _LocalWindow(fallback_max_keys)
        self._acquire_script: Any = redis.register_script(_ACQUIRE_SCRIPT)

    def _key(self, rule: RateLimit, subject: str) -> str:
        return f"rl:{rule.name}:{self._keys.mac(KeyPurpose.RATE_LIMIT, subject)}"

    def _fallback(self, rule: RateLimit | None, exc: Exception) -> None:
        logger.warning(
            "rate limit backend unavailable; using in-process fallback",
            extra={
                "event": "rate_limit.backend_unavailable",
                "check": rule.name if rule else "release",
                "error_type": type(exc).__name__,
            },
        )

    async def acquire(self, rule: RateLimit, subject: str) -> Acquired:
        """Atomically reserve a slot, or report how long until one frees up."""
        key, member, now = self._key(rule, subject), uuid.uuid4().hex, time.time()
        try:
            result = await self._acquire_script(
                keys=[key],
                args=[int(now * 1000), rule.window_seconds * 1000, rule.limit, member],
            )
        except Exception as exc:
            self._fallback(rule, exc)
            wait = self._local.acquire(key, member, rule, now)
            if wait is not None:
                return Acquired(reservation=None, retry_after=max(wait, 1.0))
            return Acquired(Reservation(key, member, local=True), retry_after=None)
        value = int(cast(int, result))
        if value >= 0:
            return Acquired(reservation=None, retry_after=max(value / 1000, 1.0))
        return Acquired(Reservation(key, member, local=False), retry_after=None)

    async def release(self, reservation: Reservation | None) -> None:
        """Uncount an attempt (e.g. a successful login when only failures should count)."""
        if reservation is None:
            return
        if reservation.local:
            self._local.release(reservation.key, reservation.member)
            return
        try:
            await self._redis.zrem(reservation.key, reservation.member)
        except Exception as exc:
            self._fallback(None, exc)
