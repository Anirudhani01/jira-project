"""Effective story points resolution (B2)."""

import pytest

from app.modules.projects.story_points_effective import (
    effective_story_points_enabled,
    effective_story_points_max,
    resolve_story_points_settings,
    stored_override_conflicts,
)


def test_effective_enabled_inherits_true_when_override_null() -> None:
    assert effective_story_points_enabled(True, None) is True
    assert effective_story_points_enabled(False, None) is False


def test_effective_enabled_honors_project_override() -> None:
    assert effective_story_points_enabled(True, False) is False
    assert effective_story_points_enabled(True, True) is True
    assert effective_story_points_enabled(False, True) is False


def test_effective_max_inherits_org_when_override_null() -> None:
    assert effective_story_points_max(100, None) == 100


def test_effective_max_uses_project_override_without_clamping() -> None:
    assert effective_story_points_max(21, 50) == 50


def test_resolve_provenance() -> None:
    resolved = resolve_story_points_settings(
        org_enabled=True,
        org_max=100,
        enabled_override=False,
        max_override=8,
    )
    assert resolved.provenance.story_points_enabled == "project"
    assert resolved.provenance.story_points_max == "project"
    assert resolved.effective.story_points_enabled is False
    assert resolved.effective.story_points_max == 8


def test_stored_override_conflicts_when_org_disabled_and_project_re_enables() -> None:
    assert stored_override_conflicts(
        org_enabled=False,
        org_max=100,
        enabled_override=True,
        max_override=None,
    ) == ["story_points_enabled_override"]


def test_stored_override_conflicts_when_max_exceeds_org() -> None:
    assert stored_override_conflicts(
        org_enabled=True,
        org_max=21,
        enabled_override=None,
        max_override=50,
    ) == ["story_points_max_override"]


@pytest.mark.parametrize(
    ("org_enabled", "enabled_override", "max_override", "expected"),
    [
        (True, None, None, []),
        (True, False, 8, []),
        (False, None, None, []),
    ],
)
def test_no_conflict_for_valid_stored_overrides(
    org_enabled: bool,
    enabled_override: bool | None,
    max_override: int | None,
    expected: list[str],
) -> None:
    assert (
        stored_override_conflicts(
            org_enabled=org_enabled,
            org_max=100,
            enabled_override=enabled_override,
            max_override=max_override,
        )
        == expected
    )
