"""Sprint data access (M10). Runs under RLS inside an org transaction."""

import uuid
from typing import Any

from sqlalchemy import case, delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.issues.models import Issue
from app.modules.projects.models import Project, WorkflowStatus
from app.modules.sprints.models import Sprint

_STATE_ORDER = case((Sprint.state == "active", 0), (Sprint.state == "future", 1), else_=2)


async def find_sprint_project_key(session: AsyncSession, sprint_id: uuid.UUID) -> str | None:
    context = require_org_context(session)
    return (
        await session.execute(
            select(Project.key)
            .join(Sprint, Sprint.project_id == Project.id)
            .where(Sprint.org_id == context.org_id, Sprint.id == sprint_id)
        )
    ).scalar_one_or_none()


async def find_sprint(
    session: AsyncSession,
    project_id: uuid.UUID,
    sprint_id: uuid.UUID,
    *,
    lock: str | None = None,
) -> Sprint | None:
    """``lock``: ``"update"`` (start/complete/edit/delete) or ``"share"`` (assigning an
    issue, plan R4), so assignment serializes against completion."""
    context = require_org_context(session)
    query = select(Sprint).where(
        Sprint.org_id == context.org_id, Sprint.project_id == project_id, Sprint.id == sprint_id
    )
    if lock == "update":
        query = query.with_for_update()
    elif lock == "share":
        query = query.with_for_update(read=True)
    return (await session.execute(query)).scalar_one_or_none()


async def find_active(session: AsyncSession, project_id: uuid.UUID) -> Sprint | None:
    context = require_org_context(session)
    return (
        await session.execute(
            select(Sprint).where(
                Sprint.org_id == context.org_id,
                Sprint.project_id == project_id,
                Sprint.state == "active",
            )
        )
    ).scalar_one_or_none()


async def list_sprints(
    session: AsyncSession, project_id: uuid.UUID, *, include_closed: bool = True
) -> list[Sprint]:
    context = require_org_context(session)
    query = select(Sprint).where(Sprint.org_id == context.org_id, Sprint.project_id == project_id)
    if not include_closed:
        query = query.where(Sprint.state != "closed")
    return list(
        (
            await session.execute(query.order_by(_STATE_ORDER, Sprint.created_at.desc(), Sprint.id))
        ).scalars()
    )


async def issue_counts(session: AsyncSession, project_id: uuid.UUID) -> dict[uuid.UUID, int]:
    context = require_org_context(session)
    rows = await session.execute(
        select(Issue.sprint_id, func.count())
        .where(
            Issue.org_id == context.org_id,
            Issue.project_id == project_id,
            Issue.sprint_id.is_not(None),
            Issue.deleted_at.is_(None),
        )
        .group_by(Issue.sprint_id)
    )
    return {sprint_id: count for sprint_id, count in rows if sprint_id is not None}


async def create_sprint(
    session: AsyncSession, project_id: uuid.UUID, name: str, goal: str | None
) -> uuid.UUID:
    context = require_org_context(session)
    sprint_id = uuid.uuid4()
    await session.execute(
        insert(Sprint).values(
            id=sprint_id, org_id=context.org_id, project_id=project_id, name=name, goal=goal
        )
    )
    return sprint_id


async def update_sprint(session: AsyncSession, sprint_id: uuid.UUID, **values: Any) -> None:
    context = require_org_context(session)
    await session.execute(
        update(Sprint)
        .where(Sprint.org_id == context.org_id, Sprint.id == sprint_id)
        .values(updated_at=func.now(), **values)
    )


async def delete_sprint(session: AsyncSession, sprint_id: uuid.UUID) -> None:
    context = require_org_context(session)
    await session.execute(
        delete(Sprint).where(Sprint.org_id == context.org_id, Sprint.id == sprint_id)
    )


async def carry_over(
    session: AsyncSession, sprint_id: uuid.UUID, target_id: uuid.UUID | None
) -> list[tuple[uuid.UUID, int]]:
    """Moves the sprint's unfinished issues to ``target_id`` (``None`` = backlog), bumping
    each ``version`` (plan R4). Returns ``(issue_id, new_version)`` pairs."""
    context = require_org_context(session)
    unfinished = select(WorkflowStatus.id).where(WorkflowStatus.category != "done")
    rows = await session.execute(
        update(Issue)
        .where(
            Issue.org_id == context.org_id,
            Issue.sprint_id == sprint_id,
            Issue.deleted_at.is_(None),
            Issue.status_id.in_(unfinished),
        )
        .values(sprint_id=target_id, version=Issue.version + 1, updated_at=func.now())
        .returning(Issue.id, Issue.version)
    )
    return [(issue_id, version) for issue_id, version in rows]
