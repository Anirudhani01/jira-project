"""Database reads for org authentication activity (projection table only)."""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.org_auth_activity.models import OrgAuthenticationEvent


@dataclass(frozen=True, slots=True)
class AuthActivityQuery:
    member_user_id: uuid.UUID | None = None
    event_type: str | None = None
    occurred_from: datetime | None = None
    occurred_to: datetime | None = None


async def list_events(
    session: AsyncSession,
    query: AuthActivityQuery,
    *,
    limit: int,
    after: tuple[datetime, int] | None,
) -> list[OrgAuthenticationEvent]:
    """Newest first; ``after`` is the (occurred_at, id) of the last row already returned."""
    context = require_org_context(session)
    conditions: list[Any] = [OrgAuthenticationEvent.org_id == context.org_id]
    if query.member_user_id is not None:
        conditions.append(OrgAuthenticationEvent.user_id == query.member_user_id)
    if query.event_type is not None:
        conditions.append(OrgAuthenticationEvent.event_type == query.event_type)
    if query.occurred_from is not None:
        conditions.append(OrgAuthenticationEvent.occurred_at >= query.occurred_from)
    if query.occurred_to is not None:
        conditions.append(OrgAuthenticationEvent.occurred_at < query.occurred_to)
    if after is not None:
        occurred_at, event_id = after
        conditions.append(
            or_(
                OrgAuthenticationEvent.occurred_at < occurred_at,
                and_(
                    OrgAuthenticationEvent.occurred_at == occurred_at,
                    OrgAuthenticationEvent.id < event_id,
                ),
            )
        )
    result = await session.execute(
        select(OrgAuthenticationEvent)
        .where(*conditions)
        .order_by(OrgAuthenticationEvent.occurred_at.desc(), OrgAuthenticationEvent.id.desc())
        .limit(limit)
    )
    return list(result.scalars())
