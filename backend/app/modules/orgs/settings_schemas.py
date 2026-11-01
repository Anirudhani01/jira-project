"""Organization settings API models (A5.2)."""

from datetime import datetime
from typing import Annotated, Self

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, model_validator

from app.modules.orgs.settings_defaults import STORY_POINTS_MAX_LIMIT, STORY_POINTS_MAX_MIN
from app.modules.orgs.settings_validation import (
    LocaleValidationError,
    TimezoneValidationError,
    normalize_bcp47_locale,
    validate_iana_timezone,
)

StoryPointsMax = Annotated[int, Field(ge=STORY_POINTS_MAX_MIN, le=STORY_POINTS_MAX_LIMIT)]


def _timezone_field(value: str) -> str:
    try:
        return validate_iana_timezone(value)
    except TimezoneValidationError as exc:
        raise ValueError(str(exc)) from exc


def _locale_field(value: str) -> str:
    try:
        return normalize_bcp47_locale(value)
    except LocaleValidationError as exc:
        raise ValueError(str(exc)) from exc


IanaTimezone = Annotated[str, AfterValidator(_timezone_field)]
Bcp47Locale = Annotated[str, AfterValidator(_locale_field)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class UpdateOrgSettingsRequest(_Request):
    timezone: IanaTimezone | None = None
    locale: Bcp47Locale | None = None
    story_points_enabled: bool | None = None
    story_points_max: StoryPointsMax | None = None

    @model_validator(mode="after")
    def patch_has_updates(self) -> Self:
        fields_set = self.model_fields_set
        if not fields_set:
            raise ValueError("at least one field must be provided")
        for name in ("timezone", "locale", "story_points_enabled", "story_points_max"):
            if name in fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} must not be null")
        return self


class OrgSettingsResponse(BaseModel):
    timezone: str
    locale: str
    story_points_enabled: bool
    story_points_max: int
    updated_at: datetime
