"""Project request/response models. Requests forbid unknown fields."""

import re
import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.modules.projects.models import KEY_PATTERN

_KEY = re.compile(KEY_PATTERN)


def _validate_key(value: str) -> str:
    value = value.strip().upper()
    if not _KEY.fullmatch(value):
        raise ValueError("must be 2-10 characters: A-Z and digits, starting with a letter")
    return value


ProjectKey = Annotated[str, Field(max_length=16), AfterValidator(_validate_key)]
ProjectName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
ProjectRole = Literal["admin", "member", "viewer"]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateProjectRequest(_Request):
    key: ProjectKey
    name: ProjectName
    description: Description | None = None
    board_type: Literal["kanban", "scrum"] = "kanban"


class UpdateProjectRequest(_Request):
    name: ProjectName | None = None
    description: Description | None = None
    # Accepted only so it can be rejected with `field_immutable`; never applied.
    key: Any = Field(default=None, json_schema_extra={"readOnly": True})


class ProjectSummary(BaseModel):
    key: str
    name: str
    board_type: str
    archived: bool
    my_role: str | None


class ProjectListResponse(BaseModel):
    items: list[ProjectSummary]


class ProjectResponse(BaseModel):
    id: uuid.UUID
    key: str
    name: str
    description: str | None
    board_type: str
    archived: bool
    my_role: str | None
    permissions: list[str]
    created_at: datetime


class StatusResponse(BaseModel):
    id: uuid.UUID
    name: str
    category: str
    position: int


class TransitionResponse(BaseModel):
    id: uuid.UUID
    name: str
    from_status_id: uuid.UUID | None
    to_status_id: uuid.UUID


class ColumnResponse(BaseModel):
    name: str
    position: int
    status_ids: list[uuid.UUID]


class WorkflowResponse(BaseModel):
    name: str
    initial_status_id: uuid.UUID
    statuses: list[StatusResponse]
    transitions: list[TransitionResponse]
    columns: list[ColumnResponse]


class ProjectMemberResponse(BaseModel):
    user_id: uuid.UUID
    display_name: str
    email: str
    role: str


class ProjectMemberListResponse(BaseModel):
    items: list[ProjectMemberResponse]


class AddProjectMemberRequest(_Request):
    user_id: uuid.UUID
    role: ProjectRole


class UpdateProjectMemberRequest(_Request):
    role: ProjectRole
