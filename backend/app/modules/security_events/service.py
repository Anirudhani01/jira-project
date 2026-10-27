"""Recording platform security events (plan V2.7).

Metadata is allowlisted per event type: an unexpected key is a programming error and
raises, so secrets cannot slip in through ad-hoc metadata. Success events are written
in the caller's transaction; failure events use ``record_isolated`` (own transaction,
fail-open: an event-store outage must not block logins).
"""

import logging
import uuid
from dataclasses import dataclass
from typing import Final, Literal, cast

from sqlalchemy import Table, insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.logging import request_id_var
from app.modules.security_events.models import PlatformSecurityEvent

logger = logging.getLogger("app.security_events")

Outcome = Literal["success", "failure", "info"]
MetadataValue = str | int | bool

EVENTS_TABLE = cast(Table, PlatformSecurityEvent.__table__)

EVENT_METADATA_ALLOWLIST: Final[dict[str, frozenset[str]]] = {
    "auth.signup.requested": frozenset({"breach_check"}),
    "auth.login.succeeded": frozenset({"sessions_evicted", "rehashed"}),
    "auth.login.failed": frozenset(),
    "auth.logout": frozenset(),
    "auth.password.changed": frozenset({"breach_check", "sessions_revoked"}),
    "auth.session.revoked": frozenset({"scope", "count"}),
    "auth.rate_limited": frozenset({"rule"}),
    "user.verified_by_cli": frozenset(),
    # M2
    "auth.email.verified": frozenset({"sessions_revoked", "rotated"}),
    "auth.password_reset.requested": frozenset(),
    "auth.password.reset": frozenset({"breach_check", "sessions_revoked"}),
    "auth.token.rejected": frozenset({"purpose"}),
}


@dataclass(frozen=True, slots=True)
class ClientInfo:
    ip: str | None
    user_agent: str | None


def _values(
    event_type: str,
    outcome: Outcome,
    client: ClientInfo,
    *,
    user_id: uuid.UUID | None = None,
    email_hmac: str | None = None,
    reason: str | None = None,
    metadata: dict[str, MetadataValue] | None = None,
) -> dict[str, object]:
    allowed = EVENT_METADATA_ALLOWLIST.get(event_type)
    if allowed is None:
        raise ValueError(f"unknown security event type: {event_type}")
    metadata = metadata or {}
    unexpected = set(metadata) - allowed
    if unexpected:
        raise ValueError(f"metadata keys not allowlisted for {event_type}: {sorted(unexpected)}")
    return {
        "event_type": event_type,
        "outcome": outcome,
        "user_id": user_id,
        "email_hmac": email_hmac,
        "ip": client.ip,
        "user_agent": client.user_agent[:256] if client.user_agent else None,
        "request_id": request_id_var.get(),
        "reason": reason,
        "metadata": metadata,
    }


async def record(
    session: AsyncSession,
    event_type: str,
    outcome: Outcome,
    client: ClientInfo,
    *,
    user_id: uuid.UUID | None = None,
    email_hmac: str | None = None,
    reason: str | None = None,
    metadata: dict[str, MetadataValue] | None = None,
) -> None:
    """Insert in the caller's transaction (no RETURNING: runtime roles cannot SELECT)."""
    values = _values(
        event_type,
        outcome,
        client,
        user_id=user_id,
        email_hmac=email_hmac,
        reason=reason,
        metadata=metadata,
    )
    await session.execute(insert(EVENTS_TABLE).inline().values(**values))


async def record_isolated(
    sessionmaker: async_sessionmaker[AsyncSession],
    event_type: str,
    outcome: Outcome,
    client: ClientInfo,
    *,
    user_id: uuid.UUID | None = None,
    email_hmac: str | None = None,
    reason: str | None = None,
    metadata: dict[str, MetadataValue] | None = None,
) -> None:
    """Own transaction; never raises (fail-open) except for programming errors."""
    values = _values(
        event_type,
        outcome,
        client,
        user_id=user_id,
        email_hmac=email_hmac,
        reason=reason,
        metadata=metadata,
    )
    try:
        async with sessionmaker() as session, session.begin():
            await session.execute(insert(EVENTS_TABLE).inline().values(**values))
    except Exception as exc:
        logger.error(
            "failed to record security event",
            extra={
                "event": "security_event.write_failed",
                "error_type": type(exc).__name__,
                "outcome": event_type,
            },
        )
