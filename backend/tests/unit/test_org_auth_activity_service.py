"""Unit tests for org authentication activity read path."""

import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.core.errors import AppError
from app.modules.org_auth_activity.constants import PROJECTABLE_EVENT_TYPES
from app.modules.org_auth_activity.service import (
    AuthActivityFilter,
    public_metadata,
    validate_filters,
)

MIGRATION_0018 = (
    Path(__file__).resolve().parents[2]
    / "migrations"
    / "versions"
    / "0018_org_authentication_events.py"
)


def test_public_metadata_is_allowlisted_per_event_type() -> None:
    raw = {"sessions_evicted": 2, "rehashed": True, "ip": "127.0.0.1", "token": "secret"}
    assert public_metadata("auth.login.succeeded", raw) == {
        "sessions_evicted": 2,
        "rehashed": True,
    }


def test_validate_filters_rejects_unknown_event_type() -> None:
    with pytest.raises(AppError) as exc:
        validate_filters(AuthActivityFilter(event_type="auth.signup.requested"))
    assert exc.value.code == "invalid_event_type"


def test_api_projectable_event_types_match_projection_sql() -> None:
    text = MIGRATION_0018.read_text(encoding="utf-8")
    in_sql = set(re.findall(r"'(auth\.[a-z_\.]+)'", text))
    auth_types = {t for t in in_sql if t.startswith("auth.")}
    assert auth_types == PROJECTABLE_EVENT_TYPES


def test_validate_filters_rejects_inverted_date_range() -> None:
    start = datetime(2026, 1, 2, tzinfo=UTC)
    end = datetime(2026, 1, 1, tzinfo=UTC)
    with pytest.raises(AppError) as exc:
        validate_filters(AuthActivityFilter(occurred_from=start, occurred_to=end))
    assert exc.value.code == "invalid_date_range"
