"""Board read and column configuration (M9, plan §3). Cards are the project's issues
mapped to columns through their status; the card cap is 500 (plan §4.6)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.boards import repository
from app.modules.boards.schemas import (
    BoardColumn,
    BoardResponse,
    BoardTransition,
    ReplaceColumnsRequest,
)
from app.modules.identity.deps import IdentityServices
from app.modules.issues import repository as issues
from app.modules.issues.schemas import SprintRef
from app.modules.issues.service import issue_responses
from app.modules.projects.models import Project
from app.modules.projects.service import project_archived
from app.modules.security_events.service import ClientInfo
from app.modules.sprints import repository as sprints

CARD_CAP = 500
DONE_WITHIN_DAYS = 14


async def _board(session: AsyncSession, project: Project) -> BoardResponse:
    board = await repository.find_board(session, project.id)
    columns = await repository.list_columns(session, board.id)
    mapping = await repository.column_statuses(session, board.id)
    transitions = await repository.list_transitions(session, project.workflow_id)
    sprint = None
    if project.board_type == "scrum":  # a scrum board shows the active sprint only
        sprint = await sprints.find_active(session, project.id)
    rows = (
        []
        if project.board_type == "scrum" and sprint is None
        else await issues.list_board_views(
            session,
            project.id,
            done_within_days=DONE_WITHIN_DAYS,
            limit=CARD_CAP + 1,
            sprint_id=sprint.id if sprint else None,
        )
    )
    truncated = len(rows) > CARD_CAP
    cards = await issue_responses(session, rows[:CARD_CAP])
    column_of = {
        status_id: column.id for column in columns for status_id in mapping.get(column.id, [])
    }
    by_column: dict[uuid.UUID, list] = {column.id: [] for column in columns}  # type: ignore[type-arg]
    for card in cards:
        by_column[column_of[card.status.id]].append(card)
    return BoardResponse(
        project_key=project.key,
        board_type=project.board_type,
        columns=[
            BoardColumn(
                id=column.id,
                name=column.name,
                position=column.position,
                wip_limit=column.wip_limit,
                status_ids=mapping.get(column.id, []),
                count=len(by_column[column.id]),
                over_wip_limit=column.wip_limit is not None
                and len(by_column[column.id]) > column.wip_limit,
                issues=by_column[column.id],
            )
            for column in columns
        ],
        transitions=[
            BoardTransition(from_status_id=t.from_status_id, to_status_id=t.to_status_id)
            for t in transitions
        ],
        truncated=truncated,
        sprint=SprintRef(id=sprint.id, name=sprint.name, state=sprint.state) if sprint else None,
    )


async def get_board(services: IdentityServices, access: ProjectAccess) -> BoardResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        return await _board(session, project)


def _invalid(message: str, field: str = "body.columns") -> AppError:
    return AppError(
        422, "invalid_board_columns", message, errors=[{"field": field, "message": message}]
    )


async def replace_columns(
    services: IdentityServices,
    access: ProjectAccess,
    body: ReplaceColumnsRequest,
    client: ClientInfo,
) -> BoardResponse:
    async with project_transaction(services, access, Permission.BOARD_MANAGE) as (
        session,
        project,
        current,
    ):
        if project.archived_at is not None:
            raise project_archived()
        board = await repository.find_board(session, project.id)
        known = {column.id for column in await repository.list_columns(session, board.id)}
        ids = [column.id for column in body.columns if column.id is not None]
        if len(ids) != len(set(ids)) or not set(ids) <= known:
            raise _invalid("Column ids must be unique columns of this board.")
        mapped = [status for column in body.columns for status in column.status_ids]
        statuses = await repository.workflow_status_ids(session, project.workflow_id)
        if len(mapped) != len(set(mapped)) or set(mapped) != statuses:
            raise _invalid("Every workflow status must be mapped to exactly one column.")
        await repository.replace_columns(
            session,
            board,
            [
                (column.id or uuid.uuid4(), column.name, column.wip_limit, column.status_ids)
                for column in body.columns
            ],
        )
        await audit.record(
            session,
            "board.columns.updated",
            client,
            actor_user_id=current.org.user_id,
            target_type="project",
            target_id=str(project.id),
            metadata={"project": project.key, "columns": len(body.columns)},
        )
        return await _board(session, project)
