"""Versions / releases (research: docs/ui-redesign/jira-reference-research.md §6.2).

``unreleased -> released -> archived``. Releasing asks what to do with unresolved issues
(leave them, or move them to another unreleased version); deleting a version can move its
issues to another one. Every issue change goes through ``issue_activity`` and bumps the
issue ``version`` like any other field change."""

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import not_found
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.authz.versions import VersionRef
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.issues import repository as issues
from app.modules.projects.models import Project
from app.modules.projects.service import project_archived
from app.modules.security_events.service import ClientInfo
from app.modules.versions import repository
from app.modules.versions.models import Version
from app.modules.versions.schemas import (
    CreateVersionRequest,
    ReleaseVersionRequest,
    ReleaseVersionResponse,
    ReorderVersionsRequest,
    UpdateVersionRequest,
    VersionListResponse,
    VersionResponse,
)


def _conflict(code: str, message: str) -> AppError:
    return AppError(409, code, message)


def name_taken() -> AppError:
    return _conflict("version_name_taken", "A version with this name already exists.")


def _today() -> date:
    return datetime.now(UTC).date()


def _response(
    project_key: str, version: Version, stats: dict[uuid.UUID, repository.VersionStats]
) -> VersionResponse:
    own = stats.get(version.id, repository.VersionStats())
    return VersionResponse(
        id=version.id,
        project_key=project_key,
        name=version.name,
        description=version.description,
        start_date=version.start_date,
        release_date=version.release_date,
        status=version.status,
        released_at=version.released_at,
        position=version.position,
        overdue=version.status == "unreleased"
        and version.release_date is not None
        and version.release_date < _today(),
        issue_count=own.total,
        todo_count=own.todo,
        in_progress_count=own.in_progress,
        done_count=own.done,
    )


async def _one(session: AsyncSession, project: Project, version_id: uuid.UUID) -> VersionResponse:
    version = await repository.find_version(session, project.id, version_id)
    if version is None:
        raise not_found()
    return _response(project.key, version, await repository.version_stats(session, project.id))


def _writable(project: Project) -> None:
    if project.archived_at is not None:
        raise project_archived()


async def _lock(session: AsyncSession, project: Project, ref: VersionRef) -> Version:
    version = await repository.find_version(session, project.id, ref.version_id, lock=True)
    if version is None:
        raise not_found()
    return version


async def _target(
    session: AsyncSession, project: Project, source_id: uuid.UUID, target_id: uuid.UUID
) -> Version:
    """The version issues are moved to: same project, not the source, not archived."""
    target = await repository.find_version(session, project.id, target_id)
    if target is None or target.id == source_id or target.status == "archived":
        raise AppError(
            422,
            "invalid_target_version",
            "Choose a different, non-archived version of this project.",
        )
    return target


def _fix_version_ref(version: Version | None) -> dict[str, str] | None:
    return {"id": str(version.id), "name": version.name} if version else None


async def _log_moves(
    session: AsyncSession, moved: list[uuid.UUID], old: Version, new: Version | None
) -> None:
    await issues.add_activity(
        session,
        [
            {
                "issue_id": issue_id,
                "action": "updated",
                "field": "fix_version",
                "old_value": _fix_version_ref(old),
                "new_value": _fix_version_ref(new),
            }
            for issue_id in moved
        ],
    )


async def list_versions(
    services: IdentityServices, access: ProjectAccess, *, include_archived: bool
) -> VersionListResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        versions = await repository.list_versions(
            session, project.id, include_archived=include_archived
        )
        stats = await repository.version_stats(session, project.id)
        return VersionListResponse(items=[_response(project.key, v, stats) for v in versions])


async def create_version(
    services: IdentityServices, access: ProjectAccess, body: CreateVersionRequest
) -> VersionResponse:
    async with project_transaction(services, access, Permission.VERSION_MANAGE) as (
        session,
        project,
        _,
    ):
        _writable(project)
        try:
            version_id = await repository.create_version(
                session,
                project.id,
                name=body.name,
                description=body.description,
                start_date=body.start_date,
                release_date=body.release_date,
                position=await repository.next_position(session, project.id),
            )
            await session.flush()
        except IntegrityError as error:
            raise name_taken() from error
        return await _one(session, project, version_id)


async def update_version(
    services: IdentityServices, ref: VersionRef, body: UpdateVersionRequest
) -> VersionResponse:
    async with project_transaction(services, ref.project, Permission.VERSION_MANAGE) as (
        session,
        project,
        _,
    ):
        _writable(project)
        version = await _lock(session, project, ref)
        fields = body.model_fields_set
        changes: dict[str, Any] = {}
        if body.name is not None:
            changes["name"] = body.name
        if "description" in fields:
            changes["description"] = body.description
        if "start_date" in fields:
            changes["start_date"] = body.start_date
        if "release_date" in fields:
            changes["release_date"] = body.release_date
        start = changes.get("start_date", version.start_date)
        end = changes.get("release_date", version.release_date)
        if start is not None and end is not None and end < start:
            raise AppError(
                422,
                "invalid_dates",
                "The release date must not be before the start date.",
                errors=[{"field": "body.release_date", "message": "is before the start date"}],
            )
        if changes:
            try:
                await repository.update_version(session, version.id, **changes)
                await session.flush()
            except IntegrityError as error:
                raise name_taken() from error
        return await _one(session, project, version.id)


async def reorder_versions(
    services: IdentityServices, access: ProjectAccess, body: ReorderVersionsRequest
) -> VersionListResponse:
    async with project_transaction(services, access, Permission.VERSION_MANAGE) as (
        session,
        project,
        _,
    ):
        _writable(project)
        existing = await repository.list_versions(session, project.id, include_archived=True)
        known = [v.id for v in existing]
        if len(set(body.ids)) != len(body.ids) or not set(body.ids) <= set(known):
            raise AppError(422, "invalid_order", "List each version of this project at most once.")
        # Listed versions first, in the given order; the rest keep their relative order.
        rest = [v for v in known if v not in set(body.ids)]
        await repository.set_positions(session, [*body.ids, *rest])
        stats = await repository.version_stats(session, project.id)
        versions = await repository.list_versions(session, project.id, include_archived=False)
        return VersionListResponse(items=[_response(project.key, v, stats) for v in versions])


async def delete_version(
    services: IdentityServices,
    ref: VersionRef,
    move_to: uuid.UUID | None,
    client: ClientInfo,
) -> None:
    async with project_transaction(services, ref.project, Permission.VERSION_MANAGE) as (
        session,
        project,
        current,
    ):
        _writable(project)
        version = await _lock(session, project, ref)
        target = await _target(session, project, version.id, move_to) if move_to else None
        moved = await repository.move_issues(
            session, version.id, target.id if target else None, unresolved_only=False
        )
        await _log_moves(session, moved, version, target)
        await repository.delete_version(session, version.id)
        await audit.record(
            session,
            "version.deleted",
            client,
            actor_user_id=current.org.user_id,
            target_type="version",
            target_id=str(version.id),
            metadata={"project": project.key, "name": version.name},
        )


async def release_version(
    services: IdentityServices, ref: VersionRef, body: ReleaseVersionRequest, client: ClientInfo
) -> ReleaseVersionResponse:
    async with project_transaction(services, ref.project, Permission.VERSION_MANAGE) as (
        session,
        project,
        current,
    ):
        _writable(project)
        version = await _lock(session, project, ref)
        if version.status != "unreleased":
            raise _conflict("version_not_unreleased", "Only an unreleased version can be released.")
        target: Version | None = None
        if body.unresolved == "move":
            if body.move_to is None:
                raise AppError(
                    422, "invalid_target_version", "Choose where to move the unresolved issues."
                )
            target = await _target(session, project, version.id, body.move_to)
            if target.status == "released":
                raise AppError(
                    422,
                    "invalid_target_version",
                    "Move unresolved issues to an unreleased version.",
                )
        moved: list[uuid.UUID] = []
        if target is not None:
            moved = await repository.move_issues(
                session, version.id, target.id, unresolved_only=True
            )
            await _log_moves(session, moved, version, target)
        released_on = body.release_date or _today()
        if version.start_date is not None and released_on < version.start_date:
            raise AppError(
                422,
                "invalid_dates",
                "The release date must not be before the start date.",
                errors=[{"field": "body.release_date", "message": "is before the start date"}],
            )
        await repository.update_version(
            session, version.id, status="released", released_at=func.now(), release_date=released_on
        )
        await audit.record(
            session,
            "version.released",
            client,
            actor_user_id=current.org.user_id,
            target_type="version",
            target_id=str(version.id),
            metadata={"project": project.key, "name": version.name, "moved": len(moved)},
        )
        return ReleaseVersionResponse(
            version=await _one(session, project, version.id), moved_issues=len(moved)
        )


async def _set_status(
    services: IdentityServices,
    ref: VersionRef,
    *,
    expect: tuple[str, ...],
    code: str,
    message: str,
    values: Any,
    audit_action: str | None = None,
    client: ClientInfo | None = None,
) -> VersionResponse:
    async with project_transaction(services, ref.project, Permission.VERSION_MANAGE) as (
        session,
        project,
        current,
    ):
        _writable(project)
        version = await _lock(session, project, ref)
        if version.status not in expect:
            raise _conflict(code, message)
        await repository.update_version(session, version.id, **values(version))
        if audit_action and client is not None:
            await audit.record(
                session,
                audit_action,
                client,
                actor_user_id=current.org.user_id,
                target_type="version",
                target_id=str(version.id),
                metadata={"project": project.key, "name": version.name},
            )
        return await _one(session, project, version.id)


async def unrelease_version(services: IdentityServices, ref: VersionRef) -> VersionResponse:
    return await _set_status(
        services,
        ref,
        expect=("released",),
        code="version_not_released",
        message="Only a released version can be unreleased.",
        values=lambda _v: {"status": "unreleased", "released_at": None},
    )


async def archive_version(
    services: IdentityServices, ref: VersionRef, client: ClientInfo
) -> VersionResponse:
    return await _set_status(
        services,
        ref,
        expect=("unreleased", "released"),
        code="version_archived",
        message="This version is already archived.",
        values=lambda _v: {"status": "archived"},
        audit_action="version.archived",
        client=client,
    )


async def unarchive_version(services: IdentityServices, ref: VersionRef) -> VersionResponse:
    return await _set_status(
        services,
        ref,
        expect=("archived",),
        code="version_not_archived",
        message="Only an archived version can be unarchived.",
        values=lambda v: {"status": "released" if v.released_at else "unreleased"},
    )
