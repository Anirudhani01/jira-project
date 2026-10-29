"""Board data access (M9). Runs under RLS inside an org transaction."""

import uuid
from typing import Any

from sqlalchemy import delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.projects.models import (
    Board,
    BoardColumn,
    BoardColumnStatus,
    WorkflowStatus,
    WorkflowTransition,
)


async def find_board(session: AsyncSession, project_id: uuid.UUID) -> Board:
    require_org_context(session)
    return (await session.execute(select(Board).where(Board.project_id == project_id))).scalar_one()


async def list_columns(session: AsyncSession, board_id: uuid.UUID) -> list[BoardColumn]:
    require_org_context(session)
    return list(
        (
            await session.execute(
                select(BoardColumn)
                .where(BoardColumn.board_id == board_id)
                .order_by(BoardColumn.position)
            )
        ).scalars()
    )


async def column_statuses(session: AsyncSession, board_id: uuid.UUID) -> dict[uuid.UUID, list[Any]]:
    """Status ids per column, in workflow order."""
    require_org_context(session)
    rows = await session.execute(
        select(BoardColumnStatus.column_id, BoardColumnStatus.status_id)
        .join(WorkflowStatus, WorkflowStatus.id == BoardColumnStatus.status_id)
        .where(BoardColumnStatus.board_id == board_id)
        .order_by(WorkflowStatus.position)
    )
    grouped: dict[uuid.UUID, list[Any]] = {}
    for column_id, status_id in rows:
        grouped.setdefault(column_id, []).append(status_id)
    return grouped


async def workflow_status_ids(session: AsyncSession, workflow_id: uuid.UUID) -> set[uuid.UUID]:
    require_org_context(session)
    return set(
        (
            await session.execute(
                select(WorkflowStatus.id).where(WorkflowStatus.workflow_id == workflow_id)
            )
        ).scalars()
    )


async def list_transitions(
    session: AsyncSession, workflow_id: uuid.UUID
) -> list[WorkflowTransition]:
    require_org_context(session)
    return list(
        (
            await session.execute(
                select(WorkflowTransition).where(WorkflowTransition.workflow_id == workflow_id)
            )
        ).scalars()
    )


async def replace_columns(
    session: AsyncSession,
    board: Board,
    columns: list[tuple[uuid.UUID, str, int | None, list[uuid.UUID]]],
) -> None:
    """Rewrites the board: mappings are cleared, columns upserted by id (position follows
    list order; the unique position constraint is deferred), dropped columns deleted."""
    context = require_org_context(session)
    await session.execute(delete(BoardColumnStatus).where(BoardColumnStatus.board_id == board.id))
    existing = {column.id for column in await list_columns(session, board.id)}
    keep = {column_id for column_id, *_ in columns}
    if existing - keep:
        await session.execute(
            delete(BoardColumn).where(
                BoardColumn.board_id == board.id, BoardColumn.id.in_(existing - keep)
            )
        )
    for position, (column_id, name, wip_limit, status_ids) in enumerate(columns):
        if column_id in existing:
            await session.execute(
                update(BoardColumn)
                .where(BoardColumn.board_id == board.id, BoardColumn.id == column_id)
                .values(name=name, position=position, wip_limit=wip_limit)
            )
        else:
            await session.execute(
                insert(BoardColumn).values(
                    id=column_id,
                    org_id=context.org_id,
                    board_id=board.id,
                    name=name,
                    position=position,
                    wip_limit=wip_limit,
                )
            )
        if status_ids:
            await session.execute(
                insert(BoardColumnStatus),
                [
                    {
                        "org_id": context.org_id,
                        "board_id": board.id,
                        "workflow_id": board.workflow_id,
                        "column_id": column_id,
                        "status_id": status_id,
                    }
                    for status_id in status_ids
                ],
            )
