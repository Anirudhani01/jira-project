"""Sprint lifecycle and backlog (M10, plan R4 / §3). ``future -> active -> closed``;
one active sprint per project (partial unique index backstop). Completing locks the
sprint (and the carry-over target) ``FOR UPDATE``; anything assigning an issue to a sprint
takes ``FOR SHARE`` and refuses ``closed``, so the two serialize."""

import uuid
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import not_found
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.authz.sprints import SprintRef
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.issues import repository as issues
from app.modules.issues.service import issue_responses
from app.modules.projects.models import Project
from app.modules.projects.service import project_archived
from app.modules.security_events.service import ClientInfo
from app.modules.sprints import repository
from app.modules.sprints.models import Sprint
from app.modules.sprints.schemas import (
    BacklogResponse,
    BacklogSprint,
    CompleteSprintRequest,
    CompleteSprintResponse,
    CreateSprintRequest,
    SprintListResponse,
    SprintResponse,
    StartSprintRequest,
    UpdateSprintRequest,
)

BACKLOG_CAP = 500


def sprint_closed() -> AppError:
    return AppError(409, "sprint_closed", "This sprint is closed.")


def _conflict(code: str, message: str) -> AppError:
    return AppError(409, code, message)


def _response(
    project_key: str, sprint: Sprint, stats: dict[uuid.UUID, repository.SprintStats]
) -> SprintResponse:
    own = stats.get(sprint.id, repository.SprintStats())
    return SprintResponse(
        id=sprint.id,
        project_key=project_key,
        name=sprint.name,
        goal=sprint.goal,
        state=sprint.state,
        start_at=sprint.start_at,
        end_at=sprint.end_at,
        completed_at=sprint.completed_at,
        issue_count=own.issue_count,
        points_total=own.points_total,
        points_done=own.points_done,
    )


async def _one(session: AsyncSession, project: Project, sprint_id: uuid.UUID) -> SprintResponse:
    sprint = await repository.find_sprint(session, project.id, sprint_id)
    if sprint is None:
        raise not_found()
    counts = await repository.sprint_stats(session, project.id)
    return _response(project.key, sprint, counts)


def _writable(project: Project) -> None:
    if project.archived_at is not None:
        raise project_archived()


async def list_sprints(services: IdentityServices, access: ProjectAccess) -> SprintListResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        sprints = await repository.list_sprints(session, project.id)
        counts = await repository.sprint_stats(session, project.id)
        return SprintListResponse(items=[_response(project.key, s, counts) for s in sprints])


async def create_sprint(
    services: IdentityServices, access: ProjectAccess, body: CreateSprintRequest
) -> SprintResponse:
    async with project_transaction(services, access, Permission.SPRINT_MANAGE) as (
        session,
        project,
        _,
    ):
        _writable(project)
        if project.board_type != "scrum":
            raise AppError(
                422, "sprints_require_scrum_project", "Only scrum projects have sprints."
            )
        sprint_id = await repository.create_sprint(session, project.id, body.name, body.goal)
        return await _one(session, project, sprint_id)


async def update_sprint(
    services: IdentityServices, ref: SprintRef, body: UpdateSprintRequest
) -> SprintResponse:
    async with project_transaction(services, ref.project, Permission.SPRINT_MANAGE) as (
        session,
        project,
        _,
    ):
        _writable(project)
        sprint = await repository.find_sprint(session, project.id, ref.sprint_id, lock="update")
        if sprint is None:
            raise not_found()
        if sprint.state == "closed":
            raise sprint_closed()
        changes: dict[str, Any] = {}
        if body.name is not None:
            changes["name"] = body.name
        if "goal" in body.model_fields_set:
            changes["goal"] = body.goal
        if changes:
            await repository.update_sprint(session, sprint.id, **changes)
        return await _one(session, project, sprint.id)


async def delete_sprint(services: IdentityServices, ref: SprintRef) -> None:
    async with project_transaction(services, ref.project, Permission.SPRINT_MANAGE) as (
        session,
        project,
        _,
    ):
        _writable(project)
        sprint = await repository.find_sprint(session, project.id, ref.sprint_id, lock="update")
        if sprint is None:
            raise not_found()
        if sprint.state != "future":
            raise _conflict("sprint_not_deletable", "Only future sprints can be deleted.")
        await repository.delete_sprint(session, sprint.id)  # issues return to the backlog


async def start_sprint(
    services: IdentityServices, ref: SprintRef, body: StartSprintRequest, client: ClientInfo
) -> SprintResponse:
    async with project_transaction(services, ref.project, Permission.SPRINT_MANAGE) as (
        session,
        project,
        current,
    ):
        _writable(project)
        sprint = await repository.find_sprint(session, project.id, ref.sprint_id, lock="update")
        if sprint is None:
            raise not_found()
        if sprint.state != "future":
            raise _conflict("sprint_not_future", "Only a future sprint can be started.")
        if await repository.find_active(session, project.id) is not None:
            raise _conflict("sprint_already_active", "This project already has an active sprint.")
        try:
            await repository.update_sprint(
                session, sprint.id, state="active", start_at=body.start_at, end_at=body.end_at
            )
            await session.flush()
        except IntegrityError as error:  # concurrent start: the partial unique index wins
            raise _conflict(
                "sprint_already_active", "This project already has an active sprint."
            ) from error
        await audit.record(
            session,
            "sprint.started",
            client,
            actor_user_id=current.org.user_id,
            target_type="sprint",
            target_id=str(sprint.id),
            metadata={"project": project.key, "name": sprint.name},
        )
        return await _one(session, project, sprint.id)


async def complete_sprint(
    services: IdentityServices, ref: SprintRef, body: CompleteSprintRequest, client: ClientInfo
) -> CompleteSprintResponse:
    async with project_transaction(services, ref.project, Permission.SPRINT_MANAGE) as (
        session,
        project,
        current,
    ):
        _writable(project)
        sprint = await repository.find_sprint(session, project.id, ref.sprint_id, lock="update")
        if sprint is None:
            raise not_found()
        if sprint.state != "active":
            raise _conflict("sprint_not_active", "Only the active sprint can be completed.")
        target: Sprint | None = None
        if body.move_open_issues_to != "backlog":
            if body.move_open_issues_to == sprint.id:
                raise AppError(422, "invalid_target_sprint", "Choose a different target sprint.")
            target = await repository.find_sprint(
                session, project.id, body.move_open_issues_to, lock="update"
            )
            if target is None or target.state != "future":
                raise AppError(
                    422,
                    "invalid_target_sprint",
                    "The target must be a future sprint of this project.",
                )
        moved = await repository.carry_over(session, sprint.id, target.id if target else None)
        await issues.add_activity(
            session,
            [
                {
                    "issue_id": issue_id,
                    "action": "sprint_changed",
                    "field": "sprint",
                    "old_value": {"id": str(sprint.id), "name": sprint.name},
                    "new_value": {"id": str(target.id), "name": target.name} if target else None,
                }
                for issue_id, _ in moved
            ],
        )
        await repository.update_sprint(session, sprint.id, state="closed", completed_at=func.now())
        await audit.record(
            session,
            "sprint.completed",
            client,
            actor_user_id=current.org.user_id,
            target_type="sprint",
            target_id=str(sprint.id),
            metadata={"project": project.key, "name": sprint.name, "moved": len(moved)},
        )
        return CompleteSprintResponse(
            sprint=await _one(session, project, sprint.id), moved_issues=len(moved)
        )


async def get_backlog(services: IdentityServices, access: ProjectAccess) -> BacklogResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        sprints = await repository.list_sprints(session, project.id, include_closed=False)
        counts = await repository.sprint_stats(session, project.id)
        rows = await issues.list_backlog_views(session, project.id, limit=BACKLOG_CAP + 1)
        truncated = len(rows) > BACKLOG_CAP
        cards = await issue_responses(session, rows[:BACKLOG_CAP])
        by_sprint: dict[uuid.UUID | None, list[Any]] = {}
        for row, card in zip(rows, cards, strict=False):
            by_sprint.setdefault(row.Issue.sprint_id, []).append(card)
        return BacklogResponse(
            project_key=project.key,
            sprints=[
                BacklogSprint(
                    sprint=_response(project.key, sprint, counts),
                    issues=by_sprint.get(sprint.id, []),
                )
                for sprint in sprints
            ],
            backlog=by_sprint.get(None, []),
            truncated=truncated,
        )
