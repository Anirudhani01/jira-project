"""Issue story points policy (B3)."""

import pytest

from app.core.errors import AppError
from app.modules.issues.story_points_policy import (
    IssueStoryPointsPolicy,
    validate_story_points_mutation,
)


def _policy(
    *,
    enabled: bool = True,
    maximum: int = 100,
    conflicts: tuple[str, ...] = (),
) -> IssueStoryPointsPolicy:
    return IssueStoryPointsPolicy(
        effective_enabled=enabled,
        effective_max=maximum,
        conflict_fields=conflicts,
    )


def test_no_op_skips_validation_when_disabled() -> None:
    validate_story_points_mutation(_policy(enabled=False), 5, 5)


def test_clear_always_allowed_even_when_disabled_or_in_conflict() -> None:
    validate_story_points_mutation(_policy(enabled=False), None, 5)
    validate_story_points_mutation(_policy(conflicts=("story_points_max_override",)), None, 8)


def test_conflict_rejects_non_null_change() -> None:
    with pytest.raises(AppError) as exc:
        validate_story_points_mutation(_policy(conflicts=("story_points_max_override",)), 8, 5)
    assert exc.value.status == 409
    assert exc.value.code == "project_settings_conflict"


def test_disabled_rejects_new_non_null_value() -> None:
    with pytest.raises(AppError) as exc:
        validate_story_points_mutation(_policy(enabled=False), 3, None)
    assert exc.value.code == "story_points_disabled"


def test_disabled_allows_unchanged_historical_value_via_no_op() -> None:
    validate_story_points_mutation(_policy(enabled=False), 3, 3)


def test_exceeds_effective_max() -> None:
    with pytest.raises(AppError) as exc:
        validate_story_points_mutation(_policy(maximum=8), 9, None)
    assert exc.value.code == "story_points_exceeds_max"


def test_accepts_value_at_effective_max() -> None:
    validate_story_points_mutation(_policy(maximum=8), 8, None)
    validate_story_points_mutation(_policy(maximum=8), 0, None)
