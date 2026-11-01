"""Organization authentication activity list (A3.2 Phase 4)."""

import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import OrgAccess, org_transaction
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.modules.identity.deps import IdentityServices
from app.modules.org_auth_activity import repository
from app.modules.org_auth_activity.constants import PROJECTABLE_EVENT_TYPES
from app.modules.org_auth_activity.models import OrgAuthenticationEvent
from app.modules.orgs.models import OrgMembership
from app.modules.security_events.service import EVENT_METADATA_ALLOWLIST

MemberStatus = Literal["active", "removed"]


@dataclass(frozen=True, slots=True)
class AuthActivityFilter:
    member_user_id: uuid.UUID | None = None
    event_type: str | None = None
    occurred_from: datetime | None = None
    occurred_to: datetime | None = None


@dataclass(frozen=True, slots=True)
class AuthActivityRow:
    id: int
    user_id: uuid.UUID
    member_display_name: str
    member_status: MemberStatus
    event_type: str
    outcome: str
    reason: str | None
    metadata: dict[str, object]
    occurred_at: datetime


def encode_cursor(event: OrgAuthenticationEvent) -> str:
    raw = json.dumps([event.occurred_at.isoformat(), event.id]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        occurred_at, event_id = json.loads(base64.urlsafe_b64decode(padded))
        return datetime.fromisoformat(occurred_at), int(event_id)
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        raise AppError(400, "invalid_cursor", "The cursor is not valid.") from None


def validate_filters(filters: AuthActivityFilter) -> None:
    if filters.event_type is not None and filters.event_type not in PROJECTABLE_EVENT_TYPES:
        raise AppError(
            400,
            "invalid_event_type",
            "Unsupported authentication event type.",
            errors=[{"field": "query.event_type", "message": "unsupported value"}],
        )
    if (
        filters.occurred_from is not None
        and filters.occurred_to is not None
        and filters.occurred_from >= filters.occurred_to
    ):
        raise AppError(
            400,
            "invalid_date_range",
            "The start date must be before the end date.",
            errors=[
                {"field": "query.from", "message": "must be before query.to"},
            ],
        )


def public_metadata(event_type: str, raw: dict[str, object]) -> dict[str, object]:
    allowed = EVENT_METADATA_ALLOWLIST.get(event_type, frozenset())
    return {key: raw[key] for key in raw if key in allowed}


async def _active_member_ids(session: AsyncSession, org_id: uuid.UUID) -> set[uuid.UUID]:
    rows = (
        await session.execute(
            select(OrgMembership.user_id).where(
                OrgMembership.org_id == org_id,
                OrgMembership.removed_at.is_(None),
            )
        )
    ).all()
    return {row.user_id for row in rows}


async def list_authentication_activity(
    services: IdentityServices,
    access: OrgAccess,
    filters: AuthActivityFilter,
    *,
    limit: int,
    cursor: str | None,
) -> tuple[list[AuthActivityRow], str | None]:
    validate_filters(filters)
    after = decode_cursor(cursor) if cursor else None
    async with org_transaction(services, access, Permission.ORG_AUDIT_VIEW) as (session, current):
        events = await repository.list_events(
            session,
            repository.AuthActivityQuery(
                member_user_id=filters.member_user_id,
                event_type=filters.event_type,
                occurred_from=filters.occurred_from,
                occurred_to=filters.occurred_to,
            ),
            limit=limit + 1,
            after=after,
        )
        active = await _active_member_ids(session, current.org_id)
    page = events[:limit]
    items = [
        AuthActivityRow(
            id=event.id,
            user_id=event.user_id,
            member_display_name=event.member_display_name,
            member_status="active" if event.user_id in active else "removed",
            event_type=event.event_type,
            outcome=event.outcome,
            reason=event.reason,
            metadata=public_metadata(event.event_type, dict(event.event_metadata)),
            occurred_at=event.occurred_at,
        )
        for event in page
    ]
    next_cursor = encode_cursor(page[-1]) if len(events) > limit else None
    return items, next_cursor
