"""Read-only user lookups for other modules (identity owns the ``users`` table, R3.4).

Runs in the caller's transaction, under ``users`` RLS: only the bound user and users who
share an active membership in the bound org are visible.
"""

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import User


@dataclass(frozen=True, slots=True)
class DirectoryUser:
    id: uuid.UUID
    display_name: str
    email: str


async def visible_users(
    session: AsyncSession, ids: list[uuid.UUID]
) -> dict[uuid.UUID, DirectoryUser]:
    if not ids:
        return {}
    rows = (
        await session.execute(
            select(User.id, User.display_name, User.email).where(User.id.in_(ids))
        )
    ).all()
    return {r.id: DirectoryUser(id=r.id, display_name=r.display_name, email=r.email) for r in rows}
