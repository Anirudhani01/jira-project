"""Version request/response models. Requests forbid unknown fields."""

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

VersionName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Description = Annotated[str, StringConstraints(max_length=1000)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _ordered(start: date | None, end: date | None) -> None:
    if start is not None and end is not None and end < start:
        raise ValueError("release_date must not be before start_date")


class CreateVersionRequest(_Request):
    name: VersionName
    description: Description | None = None
    start_date: date | None = None
    release_date: date | None = None

    @model_validator(mode="after")
    def _dates(self) -> "CreateVersionRequest":
        _ordered(self.start_date, self.release_date)
        return self


class UpdateVersionRequest(_Request):
    name: VersionName | None = None
    description: Description | None = None
    start_date: date | None = None
    release_date: date | None = None


class ReorderVersionsRequest(_Request):
    ids: list[uuid.UUID] = Field(min_length=1, max_length=200)


class ReleaseVersionRequest(_Request):
    release_date: date | None = None
    unresolved: Literal["ignore", "move"] = "ignore"
    move_to: uuid.UUID | None = None


class VersionResponse(BaseModel):
    id: uuid.UUID
    project_key: str
    name: str
    description: str | None
    start_date: date | None
    release_date: date | None
    status: str
    released_at: datetime | None
    position: int
    overdue: bool
    issue_count: int
    todo_count: int
    in_progress_count: int
    done_count: int


class VersionListResponse(BaseModel):
    items: list[VersionResponse]


class ReleaseVersionResponse(BaseModel):
    version: VersionResponse
    moved_issues: int
