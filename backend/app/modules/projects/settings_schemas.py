"""Project settings API models (B2)."""

from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.orgs.settings_defaults import STORY_POINTS_MAX_LIMIT, STORY_POINTS_MAX_MIN

StoryPointsMax = Annotated[int, Field(ge=STORY_POINTS_MAX_MIN, le=STORY_POINTS_MAX_LIMIT)]
Provenance = Literal["organization", "project"]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class StoryPointsValues(BaseModel):
    story_points_enabled: bool
    story_points_max: int


class StoryPointsOverrides(BaseModel):
    story_points_enabled: bool | None
    story_points_max: int | None


class StoryPointsProvenanceResponse(BaseModel):
    story_points_enabled: Provenance
    story_points_max: Provenance


class ProjectSettingsResponse(BaseModel):
    organization: StoryPointsValues
    overrides: StoryPointsOverrides
    effective: StoryPointsValues
    provenance: StoryPointsProvenanceResponse
    updated_at: datetime | None


class UpdateProjectSettingsRequest(_Request):
    story_points_enabled_override: bool | None = None
    story_points_max_override: StoryPointsMax | None = None

    @model_validator(mode="after")
    def patch_has_updates(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one field must be provided")
        return self
