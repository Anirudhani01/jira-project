"""Shared board column ↔ workflow status validation (A4b.2, M9)."""

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.boards import repository as boards
from app.modules.boards.schemas import ColumnInput
from app.modules.projects.models import Board, Project


def invalid_board_columns(message: str, field: str = "body.columns") -> AppError:
    return AppError(
        422,
        "invalid_board_columns",
        message,
        errors=[{"field": field, "message": message}],
    )


async def validate_column_mapping(
    session: AsyncSession,
    project: Project,
    board: Board,
    columns: list[ColumnInput],
    *,
    expected_status_ids: set[uuid.UUID],
) -> list[tuple[uuid.UUID, str, int | None, list[uuid.UUID]]]:
    known = {column.id for column in await boards.list_columns(session, board.id)}
    ids = [column.id for column in columns if column.id is not None]
    if len(ids) != len(set(ids)) or not set(ids) <= known:
        raise invalid_board_columns("Column ids must be unique columns of this board.")
    mapped = [status for column in columns for status in column.status_ids]
    if len(mapped) != len(set(mapped)) or set(mapped) != expected_status_ids:
        raise invalid_board_columns("Every workflow status must be mapped to exactly one column.")
    return [
        (column.id or uuid.uuid4(), column.name, column.wip_limit, column.status_ids)
        for column in columns
    ]
