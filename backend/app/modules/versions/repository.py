"""Version data access. Runs under RLS inside an org transaction."""

import uuid
from dataclasses import dataclass
from datetime import date
from typing import Any

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.issues.models import Issue
from app.modules.projects.models import Project, WorkflowStatus
from app.modules.versions.models import Version


async def find_version_project_key(session: AsyncSession, version_id: uuid.UUID) -> str | None:
    context = require_org_context(session)
    return (
        await session.execute(
            select(Project.key)
            .join(Version, Version.project_id == Project.id)
            .where(Version.org_id == context.org_id, Version.id == version_id)
        )
    ).scalar_one_or_none()


async def find_version(
    session: AsyncSession,
    project_id: uuid.UUID,
    version_id: uuid.UUID,
    *,
    lock: bool = False,
) -> Version | None:
    context = require_org_context(session)
    query = select(Version).where(
        Version.org_id == context.org_id,
        Version.project_id == project_id,
        Version.id == version_id,
    )
    if lock:
        query = query.with_for_update()
    return (await session.execute(query)).scalar_one_or_none()


async def list_versions(
    session: AsyncSession, project_id: uuid.UUID, *, include_archived: bool
) -> list[Version]:
    context = require_org_context(session)
    query = select(Version).where(
        Version.org_id == context.org_id, Version.project_id == project_id
    )
    if not include_archived:
        query = query.where(Version.status != "archived")
    return list((await session.execute(query.order_by(Version.position, Version.id))).scalars())


@dataclass(frozen=True, slots=True)
class VersionStats:
    total: int = 0
    todo: int = 0
    in_progress: int = 0
    done: int = 0


async def version_stats(
    session: AsyncSession, project_id: uuid.UUID
) -> dict[uuid.UUID, VersionStats]:
    """Live issues per fix version, split by status category."""
    context = require_org_context(session)

    def count(category: str) -> Any:
        return func.count().filter(WorkflowStatus.category == category)

    rows = await session.execute(
        select(
            Issue.fix_version_id,
            func.count(),
            count("todo"),
            count("in_progress"),
            count("done"),
        )
        .join(WorkflowStatus, WorkflowStatus.id == Issue.status_id)
        .where(
            Issue.org_id == context.org_id,
            Issue.project_id == project_id,
            Issue.fix_version_id.is_not(None),
            Issue.deleted_at.is_(None),
        )
        .group_by(Issue.fix_version_id)
    )
    return {
        version_id: VersionStats(int(total), int(todo), int(in_progress), int(done))
        for version_id, total, todo, in_progress, done in rows
        if version_id is not None
    }


async def next_position(session: AsyncSession, project_id: uuid.UUID) -> int:
    context = require_org_context(session)
    highest = (
        await session.execute(
            select(func.max(Version.position)).where(
                Version.org_id == context.org_id, Version.project_id == project_id
            )
        )
    ).scalar_one()
    return 0 if highest is None else int(highest) + 1


async def create_version(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    name: str,
    description: str | None,
    start_date: date | None,
    release_date: date | None,
    position: int,
) -> uuid.UUID:
    context = require_org_context(session)
    version_id = uuid.uuid4()
    await session.execute(
        insert(Version).values(
            id=version_id,
            org_id=context.org_id,
            project_id=project_id,
            name=name,
            description=description,
            start_date=start_date,
            release_date=release_date,
            position=position,
        )
    )
    return version_id


async def update_version(session: AsyncSession, version_id: uuid.UUID, **values: Any) -> None:
    context = require_org_context(session)
    await session.execute(
        update(Version)
        .where(Version.org_id == context.org_id, Version.id == version_id)
        .values(updated_at=func.now(), **values)
    )


async def delete_version(session: AsyncSession, version_id: uuid.UUID) -> None:
    context = require_org_context(session)
    await session.execute(
        delete(Version).where(Version.org_id == context.org_id, Version.id == version_id)
    )


async def set_positions(session: AsyncSession, ordered_ids: list[uuid.UUID]) -> None:
    for position, version_id in enumerate(ordered_ids):
        await update_version(session, version_id, position=position)


async def move_issues(
    session: AsyncSession,
    source_id: uuid.UUID,
    target_id: uuid.UUID | None,
    *,
    unresolved_only: bool,
) -> list[uuid.UUID]:
    """Re-points the live issues of ``source_id`` to ``target_id`` (``None`` clears the fix
    version), bumping each ``version`` (plan R4). ``unresolved_only`` skips done issues."""
    context = require_org_context(session)
    query = (
        update(Issue)
        .where(
            Issue.org_id == context.org_id,
            Issue.fix_version_id == source_id,
            Issue.deleted_at.is_(None),
        )
        .values(fix_version_id=target_id, version=Issue.version + 1, updated_at=func.now())
        .returning(Issue.id)
    )
    if unresolved_only:
        done = select(WorkflowStatus.id).where(WorkflowStatus.category == "done")
        query = query.where(Issue.status_id.not_in(done))
    return [issue_id for (issue_id,) in await session.execute(query)]
