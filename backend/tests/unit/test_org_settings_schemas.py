import pytest
from pydantic import ValidationError

from app.modules.orgs.settings_schemas import UpdateOrgSettingsRequest


def test_story_points_max_accepts_valid_range() -> None:
    body = UpdateOrgSettingsRequest(story_points_max=21)
    assert body.story_points_max == 21


@pytest.mark.parametrize("bad", [0, 101, -1])
def test_story_points_max_rejects_out_of_range(bad: int) -> None:
    with pytest.raises(ValidationError):
        UpdateOrgSettingsRequest(story_points_max=bad)


def test_story_points_enabled_rejects_null() -> None:
    with pytest.raises(ValidationError):
        UpdateOrgSettingsRequest(story_points_enabled=None)
