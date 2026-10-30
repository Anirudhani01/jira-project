"""Issue list sort + cursor encoding (PR 8 additive sorts)."""

from __future__ import annotations

import base64
import binascii
import json
import uuid
from datetime import datetime
from typing import Any, Literal

from sqlalchemy import ColumnElement, and_, case, or_

from app.core.errors import AppError
from app.modules.issues.models import Issue
from app.modules.orgs.models import Priority
from app.modules.projects.models import Project, WorkflowStatus

_CATEGORY_RANK = {"todo": 0, "in_progress": 1, "done": 2}


def invalid_cursor() -> AppError:
    return AppError(400, "invalid_cursor", "The cursor is invalid for this request.")


SortField = Literal["updated_at", "created_at", "key", "priority", "status"]

SORT_ORDERS: frozenset[str] = frozenset(
    {
        "-updated_at",
        "updated_at",
        "-created_at",
        "created_at",
        "-key",
        "key",
        "-priority",
        "priority",
        "-status",
        "status",
    }
)


def sort_field(sort: str) -> SortField:
    field = sort.removeprefix("-")
    if field not in ("updated_at", "created_at", "key", "priority", "status"):
        raise invalid_cursor()
    return field  # type: ignore[return-value]


def encode_list_cursor(sort: str, row: Any) -> str:
    issue: Issue = row.Issue
    field = sort_field(sort)
    if field in ("updated_at", "created_at"):
        value = getattr(issue, field)
        payload: list[Any] = [value.isoformat(), str(issue.id)]
    elif field == "key":
        payload = [row.project_key, issue.seq, str(issue.id)]
    elif field == "priority":
        payload = [row.priority_sort_order, issue.seq, str(issue.id)]
    else:
        rank = _CATEGORY_RANK.get(row.status_category, 3)
        payload = [rank, row.status_position, str(issue.id)]
    raw = json.dumps([sort, *payload]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_list_cursor(cursor: str, sort: str) -> tuple[Any, ...]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        parsed = json.loads(raw)
        if not isinstance(parsed, list) or len(parsed) < 2:
            raise invalid_cursor()
        cursor_sort, *rest = parsed
        if cursor_sort != sort:
            raise invalid_cursor()
        field = sort_field(sort)
        if field in ("updated_at", "created_at"):
            if len(rest) != 2:
                raise invalid_cursor()
            return (datetime.fromisoformat(rest[0]), uuid.UUID(rest[1]))
        if field == "key":
            if len(rest) != 3:
                raise invalid_cursor()
            return (rest[0], int(rest[1]), uuid.UUID(rest[2]))
        if field == "priority":
            if len(rest) != 3:
                raise invalid_cursor()
            return (int(rest[0]), int(rest[1]), uuid.UUID(rest[2]))
        if len(rest) != 3:
            raise invalid_cursor()
        return (int(rest[0]), int(rest[1]), uuid.UUID(rest[2]))
    except (ValueError, TypeError, binascii.Error) as error:
        raise invalid_cursor() from error


def _status_category_rank() -> ColumnElement[int]:
    return case(
        (WorkflowStatus.category == "todo", 0),
        (WorkflowStatus.category == "in_progress", 1),
        (WorkflowStatus.category == "done", 2),
        else_=3,
    )


def list_order(sort: str) -> tuple[Any, ...]:
    descending = sort.startswith("-")
    field = sort_field(sort)
    if field in ("updated_at", "created_at"):
        column = getattr(Issue, field)
        if descending:
            return (column.desc(), Issue.id.desc())
        return (column.asc(), Issue.id.asc())
    if field == "key":
        pk, seq = (Project.key, Issue.seq)
        if descending:
            return (pk.desc(), seq.desc(), Issue.id.desc())
        return (pk.asc(), seq.asc(), Issue.id.asc())
    if field == "priority":
        primary = Priority.sort_order.desc() if descending else Priority.sort_order.asc()
        seq_order = Issue.seq.desc() if descending else Issue.seq.asc()
        id_order = Issue.id.desc() if descending else Issue.id.asc()
        return (primary, seq_order, id_order)
    rank = _status_category_rank()
    position = WorkflowStatus.position
    if descending:
        return (rank.desc(), position.desc(), Issue.id.desc())
    return (rank.asc(), position.asc(), Issue.id.asc())


def keyset_condition(sort: str, after: tuple[Any, ...]) -> ColumnElement[bool]:  # noqa: PLR0911
    descending = sort.startswith("-")
    field = sort_field(sort)

    if field in ("updated_at", "created_at"):
        value, last_id = after
        column = getattr(Issue, field)
        if descending:
            return or_(column < value, and_(column == value, Issue.id < last_id))
        return or_(column > value, and_(column == value, Issue.id > last_id))

    if field == "key":
        project_key, seq, last_id = after
        if descending:
            return or_(
                Project.key < project_key,
                and_(Project.key == project_key, Issue.seq < seq),
                and_(Project.key == project_key, Issue.seq == seq, Issue.id < last_id),
            )
        return or_(
            Project.key > project_key,
            and_(Project.key == project_key, Issue.seq > seq),
            and_(Project.key == project_key, Issue.seq == seq, Issue.id > last_id),
        )

    if field == "priority":
        sort_order, seq, last_id = after
        if descending:
            return or_(
                Priority.sort_order < sort_order,
                and_(Priority.sort_order == sort_order, Issue.seq < seq),
                and_(
                    Priority.sort_order == sort_order,
                    Issue.seq == seq,
                    Issue.id < last_id,
                ),
            )
        return or_(
            Priority.sort_order > sort_order,
            and_(Priority.sort_order == sort_order, Issue.seq > seq),
            and_(
                Priority.sort_order == sort_order,
                Issue.seq == seq,
                Issue.id > last_id,
            ),
        )

    rank_value, position, last_id = after
    rank = _status_category_rank()
    if descending:
        return or_(
            rank < rank_value,
            and_(rank == rank_value, WorkflowStatus.position < position),
            and_(rank == rank_value, WorkflowStatus.position == position, Issue.id < last_id),
        )
    return or_(
        rank > rank_value,
        and_(rank == rank_value, WorkflowStatus.position > position),
        and_(rank == rank_value, WorkflowStatus.position == position, Issue.id > last_id),
    )
