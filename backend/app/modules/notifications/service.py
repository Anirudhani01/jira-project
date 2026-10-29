"""Notification generation and reading (M11, plan §3).

``notify`` runs inside the triggering change's transaction: the recipients are the
candidates (reporter / assignee), minus the actor, minus anyone who cannot view the
project, so a notification is never written for the person who caused it or for someone
without access. Reading is own-only (RLS)."""

import base64
import binascii
import json
import uuid
from collections.abc import Iterable
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import OrgAccess, not_found, org_transaction
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.db.tenant import require_org_context
from app.modules.identity.deps import IdentityServices
from app.modules.identity.directory import visible_users
from app.modules.notifications import repository
from app.modules.notifications.schemas import (
    NotificationActor,
    NotificationListResponse,
    NotificationResponse,
    ReadAllResponse,
    UnreadCountResponse,
)

FORMER_MEMBER = "Former member"


async def notify(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    issue_id: uuid.UUID,
    kind: str,
    candidates: Iterable[uuid.UUID | None],
    payload: dict[str, Any],
) -> int:
    """Writes one notification per eligible recipient; returns how many were written."""
    actor_id = require_org_context(session).user_id
    wanted = sorted({c for c in candidates if c is not None and c != actor_id}, key=str)
    recipients = await repository.eligible_recipients(session, project_id, wanted)
    await repository.insert_notifications(
        session,
        [
            {
                "recipient_id": recipient,
                "type": kind,
                "issue_id": issue_id,
                "payload": payload,
            }
            for recipient in sorted(recipients, key=str)
        ],
    )
    return len(recipients)


def invalid_cursor() -> AppError:
    return AppError(400, "invalid_cursor", "The cursor is invalid for this request.")


def encode_cursor(value: datetime, last_id: uuid.UUID) -> str:
    raw = json.dumps([value.isoformat(), str(last_id)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        value, last_id = json.loads(raw)
        return datetime.fromisoformat(value), uuid.UUID(last_id)
    except (ValueError, TypeError, binascii.Error) as error:
        raise invalid_cursor() from error


async def list_notifications(
    services: IdentityServices,
    org: OrgAccess,
    *,
    unread_only: bool,
    cursor: str | None,
    limit: int,
) -> NotificationListResponse:
    after = decode_cursor(cursor) if cursor else None
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, _):
        rows = await repository.list_notifications(
            session, unread_only=unread_only, after=after, limit=limit + 1
        )
        page = rows[:limit]
        users = await visible_users(
            session, sorted({r.Notification.actor_id for r in page}, key=str)
        )
    items = []
    for row in page:
        notification = row.Notification
        user = users.get(notification.actor_id)
        items.append(
            NotificationResponse(
                id=notification.id,
                type=notification.type,
                issue_key=f"{row.project_key}-{row.seq}",
                actor=NotificationActor(
                    id=notification.actor_id,
                    display_name=user.display_name if user else FORMER_MEMBER,
                ),
                payload=notification.payload,
                read=notification.read_at is not None,
                created_at=notification.created_at,
            )
        )
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1].Notification
        next_cursor = encode_cursor(last.created_at, last.id)
    return NotificationListResponse(items=items, next_cursor=next_cursor)


async def unread_count(services: IdentityServices, org: OrgAccess) -> UnreadCountResponse:
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, _):
        return UnreadCountResponse(count=await repository.unread_count(session))


async def mark_read(services: IdentityServices, org: OrgAccess, notification_id: uuid.UUID) -> None:
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, _):
        if not await repository.exists(session, notification_id):
            raise not_found()  # someone else's, or unknown: the same 404
        await repository.mark_read(session, notification_id)


async def mark_all_read(services: IdentityServices, org: OrgAccess) -> ReadAllResponse:
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, _):
        return ReadAllResponse(updated=await repository.mark_read(session, None))
