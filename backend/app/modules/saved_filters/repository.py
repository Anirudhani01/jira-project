"""Saved-filter data access. Runs under RLS inside a project transaction: only the bound
user's own rows are ever visible."""

import uuid
from typing import Any

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.saved_filters.models import SavedFilter


def _own(project_id: uuid.UUID) -> tuple[Any, ...]:
    return (SavedFilter.project_id == project_id,)


async def list_filters(session: AsyncSession, project_id: uuid.UUID) -> list[SavedFilter]:
    return list(
        (
            await session.execute(
                select(SavedFilter)
                .where(*_own(project_id))
                .order_by(func.lower(SavedFilter.name), SavedFilter.id)
            )
        ).scalars()
    )


async def count_filters(session: AsyncSession, project_id: uuid.UUID) -> int:
    return (
        await session.execute(
            select(func.count()).select_from(SavedFilter).where(*_own(project_id))
        )
    ).scalar_one()


async def find_filter(
    session: AsyncSession, project_id: uuid.UUID, filter_id: uuid.UUID
) -> SavedFilter | None:
    return (
        await session.execute(
            select(SavedFilter)
            .where(*_own(project_id), SavedFilter.id == filter_id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def create_filter(
    session: AsyncSession, project_id: uuid.UUID, *, name: str, params: dict[str, str]
) -> uuid.UUID:
    context = require_org_context(session)
    return (
        await session.execute(
            insert(SavedFilter)
            .values(
                org_id=context.org_id,
                project_id=project_id,
                user_id=context.user_id,
                name=name,
                params=params,
            )
            .returning(SavedFilter.id)
        )
    ).scalar_one()


async def update_filter(
    session: AsyncSession, filter_id: uuid.UUID, changes: dict[str, Any]
) -> None:
    await session.execute(
        update(SavedFilter)
        .where(SavedFilter.id == filter_id)
        .values(**changes, updated_at=func.now())
    )


async def delete_filter(session: AsyncSession, filter_id: uuid.UUID) -> None:
    await session.execute(delete(SavedFilter).where(SavedFilter.id == filter_id))
