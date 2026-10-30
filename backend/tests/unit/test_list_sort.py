import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.modules.issues.list_sort import decode_list_cursor, encode_list_cursor


def _row(
    *,
    project_key: str = "WEB",
    seq: int = 1,
    sort_order: int = 2,
    category: str = "todo",
    position: int = 0,
) -> SimpleNamespace:
    issue_id = uuid.uuid4()
    now = datetime(2026, 10, 30, tzinfo=UTC)
    issue = SimpleNamespace(
        id=issue_id,
        seq=seq,
        updated_at=now,
        created_at=now,
    )
    return SimpleNamespace(
        Issue=issue,
        project_key=project_key,
        priority_sort_order=sort_order,
        status_category=category,
        status_position=position,
    )


@pytest.mark.parametrize(
    "sort",
    ["-updated_at", "created_at", "-key", "key", "-priority", "priority", "-status", "status"],
)
def test_list_cursor_roundtrip(sort: str) -> None:
    row = _row()
    encoded = encode_list_cursor(sort, row)
    decoded = decode_list_cursor(encoded, sort)
    assert decoded is not None
