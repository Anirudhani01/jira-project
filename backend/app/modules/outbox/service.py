"""Enqueueing jobs into the transactional outbox (plan R4).

Jobs are inserted in the caller's transaction, so nothing is delivered for work that rolls
back. Payloads are validated to contain identifiers only: a token, password or email body
can never be written here (enforced by ``_validate`` and tested by scanning payloads).
"""

import re
import uuid
from typing import Final, cast

from sqlalchemy import Table, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.outbox.models import OutboxJob

OUTBOX_TABLE = cast(Table, OutboxJob.__table__)

# Platform topics (identity emails): global, keyed by user, always enqueued with NULL org_id.
PLATFORM_TOPICS: Final = frozenset(
    {"email.verify", "email.signup_existing", "email.password_reset"}
)
# Tenant topics must carry the bound org's id (RLS checks it). None exist before M4+.
TENANT_TOPICS: Final[frozenset[str]] = frozenset()

# topic -> allowed payload keys. Every value must be a UUID string or None.
TOPIC_PAYLOAD_KEYS: Final[dict[str, frozenset[str]]] = {
    "email.verify": frozenset({"user_id"}),
    "email.signup_existing": frozenset({"user_id"}),
    "email.password_reset": frozenset({"user_id"}),
}
_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

PayloadValue = str | None


def _validate(topic: str, payload: dict[str, PayloadValue]) -> None:
    allowed = TOPIC_PAYLOAD_KEYS.get(topic)
    if allowed is None:
        raise ValueError(f"unknown outbox topic: {topic}")
    if set(payload) != allowed:
        raise ValueError(f"payload keys for {topic} must be exactly {sorted(allowed)}")
    for key, value in payload.items():
        if value is not None and not _UUID.fullmatch(value):
            raise ValueError(f"outbox payload value {key!r} must be a UUID or null")


async def enqueue(
    session: AsyncSession,
    topic: str,
    payload: dict[str, uuid.UUID | None],
    *,
    org_id: uuid.UUID | None = None,
) -> None:
    """Insert a job in the caller's transaction (no RETURNING: the API role cannot SELECT).

    Platform topics never carry an org; tenant topics always do (and RLS only accepts the
    bound org of an active member).
    """
    values: dict[str, PayloadValue] = {k: str(v) if v else None for k, v in payload.items()}
    _validate(topic, values)
    if topic in PLATFORM_TOPICS and org_id is not None:
        raise ValueError(f"platform topic {topic} must not carry an org_id")
    if topic in TENANT_TOPICS and org_id is None:
        raise ValueError(f"tenant topic {topic} requires an org_id")
    await session.execute(
        insert(OUTBOX_TABLE).inline().values(topic=topic, payload=values, org_id=org_id)
    )
