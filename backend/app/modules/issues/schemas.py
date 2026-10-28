"""Issue request/response models. Requests forbid unknown fields, so server-owned fields
(key, reporter, status, version, org, ...) and M7 fields (assignee, parent) are rejected
with 422 (mass-assignment protection)."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

Summary = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Description = Annotated[str, StringConstraints(max_length=32000)]
SortOrder = Literal["-updated_at", "updated_at", "-created_at", "created_at"]
StatusCategory = Literal["todo", "in_progress", "done"]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateIssueRequest(_Request):
    type_id: uuid.UUID
    priority_id: uuid.UUID
    summary: Summary
    description: Description | None = None


class UpdateIssueRequest(_Request):
    """M6: summary, description, type and priority only (assignee/parent arrive in M7)."""

    summary: Summary | None = None
    description: Description | None = None
    type_id: uuid.UUID | None = None
    priority_id: uuid.UUID | None = None


class TypeRef(BaseModel):
    id: uuid.UUID
    name: str
    kind: str


class StatusRef(BaseModel):
    id: uuid.UUID
    name: str
    category: str


class PriorityRef(BaseModel):
    id: uuid.UUID
    name: str
    color: str


class UserRef(BaseModel):
    id: uuid.UUID
    display_name: str


class IssueResponse(BaseModel):
    id: uuid.UUID
    key: str
    project_key: str
    summary: str
    description: str | None
    type: TypeRef
    status: StatusRef
    priority: PriorityRef
    reporter: UserRef
    assignee: UserRef | None
    version: int
    created_at: datetime
    updated_at: datetime


class IssueListResponse(BaseModel):
    items: list[IssueResponse]
    next_cursor: str | None


class ActivityResponse(BaseModel):
    id: int
    actor: UserRef | None
    action: str
    field: str | None
    old_value: Any
    new_value: Any
    created_at: datetime


class ActivityListResponse(BaseModel):
    items: list[ActivityResponse]
    next_cursor: str | None
