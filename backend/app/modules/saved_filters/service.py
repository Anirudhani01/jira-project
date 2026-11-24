"""Saved-filter use cases. Private to the caller: RLS hides everyone else's rows, so another
user's filter is simply "not found"."""

import uuid

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import not_found
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.core.errors import AppError
from app.modules.identity.deps import IdentityServices
from app.modules.saved_filters import repository
from app.modules.saved_filters.models import SavedFilter
from app.modules.saved_filters.schemas import (
    CreateSavedFilterRequest,
    SavedFilterListResponse,
    SavedFilterResponse,
    UpdateSavedFilterRequest,
)

MAX_FILTERS = 50


def name_taken() -> AppError:
    return AppError(
        409, "saved_filter_name_taken", "You already have a saved filter with this name."
    )


def limit_reached() -> AppError:
    return AppError(
        409,
        "saved_filter_limit",
        f"You can save up to {MAX_FILTERS} filters per project. Delete one first.",
    )


def _response(row: SavedFilter) -> SavedFilterResponse:
    return SavedFilterResponse(
        id=row.id,
        name=row.name,
        params={key: str(value) for key, value in row.params.items()},
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def _one(session: AsyncSession, project_id: uuid.UUID, filter_id: uuid.UUID) -> SavedFilter:
    row = await repository.find_filter(session, project_id, filter_id)
    if row is None:
        raise not_found()
    return row


async def list_filters(
    services: IdentityServices, access: ProjectAccess
) -> SavedFilterListResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        rows = await repository.list_filters(session, project.id)
        return SavedFilterListResponse(items=[_response(r) for r in rows])


async def create_filter(
    services: IdentityServices, access: ProjectAccess, body: CreateSavedFilterRequest
) -> SavedFilterResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        if await repository.count_filters(session, project.id) >= MAX_FILTERS:
            raise limit_reached()
        try:
            filter_id = await repository.create_filter(
                session, project.id, name=body.name, params=body.params.stored()
            )
            await session.flush()
        except IntegrityError as error:
            raise name_taken() from error
        return _response(await _one(session, project.id, filter_id))


async def update_filter(
    services: IdentityServices,
    access: ProjectAccess,
    filter_id: uuid.UUID,
    body: UpdateSavedFilterRequest,
) -> SavedFilterResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        await _one(session, project.id, filter_id)
        changes: dict[str, object] = {}
        if body.name is not None:
            changes["name"] = body.name
        if body.params is not None:
            changes["params"] = body.params.stored()
        try:
            await repository.update_filter(session, filter_id, changes)
            await session.flush()
        except IntegrityError as error:
            raise name_taken() from error
        return _response(await _one(session, project.id, filter_id))


async def delete_filter(
    services: IdentityServices, access: ProjectAccess, filter_id: uuid.UUID
) -> None:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        await _one(session, project.id, filter_id)
        await repository.delete_filter(session, filter_id)
