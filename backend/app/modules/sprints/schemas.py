"""Sprint request/response models (M10). Requests forbid unknown fields."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from app.modules.issues.schemas import IssueResponse

SprintName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Goal = Annotated[str, StringConstraints(max_length=1000)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateSprintRequest(_Request):
    name: SprintName
    goal: Goal | None = None


class UpdateSprintRequest(_Request):
    name: SprintName | None = None
    goal: Goal | None = None


class StartSprintRequest(_Request):
    start_at: datetime
    end_at: datetime

    @model_validator(mode="after")
    def _ordered(self) -> "StartSprintRequest":
        if self.start_at.tzinfo is None or self.end_at.tzinfo is None:
            raise ValueError("start_at and end_at must include a timezone")
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        return self


class CompleteSprintRequest(_Request):
    move_open_issues_to: Literal["backlog"] | uuid.UUID = "backlog"


class SprintResponse(BaseModel):
    id: uuid.UUID
    project_key: str
    name: str
    goal: str | None
    state: str
    start_at: datetime | None
    end_at: datetime | None
    completed_at: datetime | None
    issue_count: int
    points_total: int
    points_done: int


class SprintListResponse(BaseModel):
    items: list[SprintResponse]


class CompleteSprintResponse(BaseModel):
    sprint: SprintResponse
    moved_issues: int


class BacklogSprint(BaseModel):
    sprint: SprintResponse
    issues: list[IssueResponse]


class BacklogResponse(BaseModel):
    project_key: str
    sprints: list[BacklogSprint]
    backlog: list[IssueResponse]
    truncated: bool
