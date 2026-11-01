"""Data access for projects, project memberships and their seeded configuration.

All functions require a bound org context (``require_org_context``) and run under RLS.
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.identity.directory import visible_users
from app.modules.projects.defaults import STATUSES, WORKFLOW_NAME
from app.modules.projects.models import (
    Board,
    BoardColumn,
    BoardColumnStatus,
    Project,
    ProjectIssueCounter,
    ProjectMembership,
    Workflow,
    WorkflowStatus,
    WorkflowTransition,
)


async def find_project(session: AsyncSession, key: str) -> Project | None:
    context = require_org_context(session)
    return (
        await session.execute(
            select(Project).where(Project.org_id == context.org_id, Project.key == key.upper())
        )
    ).scalar_one_or_none()


async def my_project_role(session: AsyncSession, project_id: uuid.UUID) -> str | None:
    require_org_context(session)
    return (
        await session.execute(
            select(ProjectMembership.role).where(
                ProjectMembership.project_id == project_id,
                ProjectMembership.user_id == func.app_current_user(),
            )
        )
    ).scalar_one_or_none()


async def list_projects(
    session: AsyncSession, *, archived: bool, all_projects: bool
) -> list[tuple[Project, str | None]]:
    """Projects visible to the caller: all (org owners/admins) or those they belong to."""
    context = require_org_context(session)
    role = (
        select(ProjectMembership.role)
        .where(
            ProjectMembership.project_id == Project.id,
            ProjectMembership.user_id == func.app_current_user(),
        )
        .scalar_subquery()
    )
    query = select(Project, role.label("my_role")).where(
        Project.org_id == context.org_id,
        Project.archived_at.is_not(None) if archived else Project.archived_at.is_(None),
    )
    if not all_projects:
        query = query.where(role.is_not(None))
    rows = (await session.execute(query.order_by(Project.key))).all()
    return [(r[0], r.my_role) for r in rows]


@dataclass(frozen=True, slots=True)
class NewProject:
    id: uuid.UUID
    key: str
    name: str
    description: str | None
    board_type: str
    creator_id: uuid.UUID


async def create_project(session: AsyncSession, new: NewProject) -> None:
    """Workflow clone, statuses, any->any transitions, project, creator as project admin,
    issue counter, board with one column per status: all in the caller's transaction."""
    context = require_org_context(session)
    org_id = context.org_id
    workflow_id = uuid.uuid4()
    status_ids = [uuid.uuid4() for _ in STATUSES]
    await session.execute(
        insert(Workflow).values(
            id=workflow_id, org_id=org_id, name=WORKFLOW_NAME, initial_status_id=status_ids[0]
        )
    )
    await session.execute(
        insert(WorkflowStatus),
        [
            {
                "id": status_id,
                "org_id": org_id,
                "workflow_id": workflow_id,
                "name": name,
                "category": category,
                "position": index,
            }
            for index, (status_id, (name, category)) in enumerate(
                zip(status_ids, STATUSES, strict=True)
            )
        ],
    )
    await session.execute(
        insert(WorkflowTransition),
        [
            {
                "org_id": org_id,
                "workflow_id": workflow_id,
                "name": f"Move to {name}",
                "from_status_id": None,
                "to_status_id": status_id,
            }
            for status_id, (name, _) in zip(status_ids, STATUSES, strict=True)
        ],
    )
    await session.execute(
        insert(Project).values(
            id=new.id,
            org_id=org_id,
            key=new.key,
            name=new.name,
            description=new.description,
            board_type=new.board_type,
            workflow_id=workflow_id,
            created_by=new.creator_id,
        )
    )
    await session.execute(
        insert(ProjectMembership).values(
            org_id=org_id, project_id=new.id, user_id=new.creator_id, role="admin"
        )
    )
    await session.execute(insert(ProjectIssueCounter).values(org_id=org_id, project_id=new.id))
    board_id = uuid.uuid4()
    await session.execute(
        insert(Board).values(
            id=board_id,
            org_id=org_id,
            project_id=new.id,
            workflow_id=workflow_id,
            name=f"{new.key} board",
        )
    )
    column_ids = [uuid.uuid4() for _ in STATUSES]
    await session.execute(
        insert(BoardColumn),
        [
            {
                "id": column_id,
                "org_id": org_id,
                "board_id": board_id,
                "name": name,
                "position": index,
            }
            for index, (column_id, (name, _)) in enumerate(zip(column_ids, STATUSES, strict=True))
        ],
    )
    await session.execute(
        insert(BoardColumnStatus),
        [
            {
                "org_id": org_id,
                "board_id": board_id,
                "workflow_id": workflow_id,
                "column_id": column_id,
                "status_id": status_id,
            }
            for column_id, status_id in zip(column_ids, status_ids, strict=True)
        ],
    )


async def update_project(session: AsyncSession, project_id: uuid.UUID, **values: Any) -> bool:
    context = require_org_context(session)
    result = await session.execute(
        update(Project)
        .where(Project.org_id == context.org_id, Project.id == project_id)
        .values(updated_at=func.now(), **values)
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def workflow_view(session: AsyncSession, project: Project) -> dict[str, Any]:
    require_org_context(session)
    statuses = list(
        (
            await session.execute(
                select(WorkflowStatus)
                .where(WorkflowStatus.workflow_id == project.workflow_id)
                .order_by(WorkflowStatus.position)
            )
        ).scalars()
    )
    transitions = list(
        (
            await session.execute(
                select(WorkflowTransition).where(
                    WorkflowTransition.workflow_id == project.workflow_id
                )
            )
        ).scalars()
    )
    workflow_row = (
        await session.execute(
            select(Workflow.name, Workflow.initial_status_id).where(
                Workflow.id == project.workflow_id
            )
        )
    ).one()
    columns = (
        await session.execute(
            select(
                BoardColumn.id, BoardColumn.name, BoardColumn.position, BoardColumnStatus.status_id
            )
            .join(Board, Board.id == BoardColumn.board_id)
            .join(BoardColumnStatus, BoardColumnStatus.column_id == BoardColumn.id, isouter=True)
            .where(Board.project_id == project.id)
            .order_by(BoardColumn.position)
        )
    ).all()
    grouped: dict[uuid.UUID, dict[str, Any]] = {}
    for column in columns:
        entry = grouped.setdefault(
            column.id, {"name": column.name, "position": column.position, "status_ids": []}
        )
        if column.status_id is not None:
            entry["status_ids"].append(column.status_id)
    return {
        "name": workflow_row.name,
        "initial_status_id": workflow_row.initial_status_id,
        "statuses": statuses,
        "transitions": transitions,
        "columns": list(grouped.values()),
    }


# ----------------------------------------------------------------- project members
@dataclass(frozen=True, slots=True)
class ProjectMemberRow:
    user_id: uuid.UUID
    display_name: str
    email: str
    role: str


async def list_project_members(
    session: AsyncSession, project_id: uuid.UUID
) -> list[ProjectMemberRow]:
    require_org_context(session)
    memberships = list(
        (
            await session.execute(
                select(ProjectMembership)
                .where(ProjectMembership.project_id == project_id)
                .order_by(ProjectMembership.created_at, ProjectMembership.user_id)
            )
        ).scalars()
    )
    users = await visible_users(session, [m.user_id for m in memberships])
    return [
        ProjectMemberRow(
            user_id=m.user_id,
            display_name=users[m.user_id].display_name,
            email=users[m.user_id].email,
            role=m.role,
        )
        for m in memberships
        if m.user_id in users
    ]


async def get_project_member(
    session: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID
) -> str | None:
    require_org_context(session)
    return (
        await session.execute(
            select(ProjectMembership.role).where(
                ProjectMembership.project_id == project_id, ProjectMembership.user_id == user_id
            )
        )
    ).scalar_one_or_none()


async def add_project_member(
    session: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> None:
    context = require_org_context(session)
    await session.execute(
        insert(ProjectMembership).values(
            org_id=context.org_id, project_id=project_id, user_id=user_id, role=role
        )
    )


async def set_project_member_role(
    session: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> None:
    require_org_context(session)
    await session.execute(
        update(ProjectMembership)
        .where(ProjectMembership.project_id == project_id, ProjectMembership.user_id == user_id)
        .values(role=role)
    )


async def remove_project_member(
    session: AsyncSession, project_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    require_org_context(session)
    await session.execute(
        delete(ProjectMembership).where(
            ProjectMembership.project_id == project_id, ProjectMembership.user_id == user_id
        )
    )


async def remove_user_from_all_projects(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Org-member removal effect (plan R4/M4): same transaction, every project of the org."""
    context = require_org_context(session)
    result = await session.execute(
        delete(ProjectMembership).where(
            ProjectMembership.org_id == context.org_id, ProjectMembership.user_id == user_id
        )
    )
    return int(result.rowcount)  # type: ignore[attr-defined]
