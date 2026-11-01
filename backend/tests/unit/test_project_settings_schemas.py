"""Project settings request validation (B2)."""

import pytest
from pydantic import ValidationError

from app.modules.projects.settings_schemas import UpdateProjectSettingsRequest


def test_explicit_null_override_is_allowed() -> None:
    body = UpdateProjectSettingsRequest.model_validate(
        {"story_points_max_override": None},
        strict=True,
    )
    assert body.story_points_max_override is None
    assert body.model_fields_set == {"story_points_max_override"}


def test_empty_patch_rejected() -> None:
    with pytest.raises(ValidationError):
        UpdateProjectSettingsRequest.model_validate({}, strict=True)


def test_max_out_of_range_rejected() -> None:
    with pytest.raises(ValidationError):
        UpdateProjectSettingsRequest(story_points_max_override=101)
