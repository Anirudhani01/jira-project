"""Issue request/response models. Requests forbid unknown fields, so server-owned fields
(key, status, version, org, ...) are rejected with 422 (mass-assignment protection).
Status changes only through the transitions endpoints (M7); ``status_id`` is never
accepted on create or update. Reporter is set on create; it may be changed on update."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, StringConstraints

Summary = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Description = Annotated[str, StringConstraints(max_length=32000)]
SortOrder = Literal[
    "-updated_at",
    "updated_at",
    "-created_at",
    "created_at",
    "-key",
    "key",
    "-priority",
    "priority",
    "-status",
    "status",
]
StatusCategory = Literal["todo", "in_progress", "done"]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateIssueRequest(_Request):
    type_id: uuid.UUID
    priority_id: uuid.UUID
    summary: Summary
    description: Description | None = None
    assignee_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    label_ids: list[uuid.UUID] | None = None


class UpdateIssueRequest(_Request):
    """Status changes go through the transitions endpoints, not here."""

    summary: Summary | None = None
    description: Description | None = None
    type_id: uuid.UUID | None = None
    priority_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    reporter_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    label_ids: list[uuid.UUID] | None = None


class TypeRef(BaseModel):
    id: uuid.UUID
    name: str
    kind: str


class StatusRef(BaseModel):
    id: uuid.UUID
    name: str
    category: str


class SprintRef(BaseModel):
    id: uuid.UUID
    name: str
    state: str


class PriorityRef(BaseModel):
    id: uuid.UUID
    name: str
    color: str


class UserRef(BaseModel):
    id: uuid.UUID
    display_name: str


class IssueRefShort(BaseModel):
    id: uuid.UUID
    key: str
    summary: str


class LabelRef(BaseModel):
    id: uuid.UUID
    name: str
    color: str


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
    parent: IssueRefShort | None
    sprint: SprintRef | None
    labels: list[LabelRef]
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


class ChildrenResponse(BaseModel):
    items: list[IssueResponse]
    done: int
    total: int


class TransitionRef(BaseModel):
    id: uuid.UUID
    name: str
    to_status: StatusRef


class TransitionListResponse(BaseModel):
    items: list[TransitionRef]


class ApplyTransitionRequest(_Request):
    transition_id: uuid.UUID


IssueKey = Annotated[str, StringConstraints(pattern=r"^[A-Z][A-Z0-9]{1,9}-[1-9][0-9]{0,8}$")]


class MoveIssueRequest(_Request):
    """Board move (M9): optional status change plus position. ``after_key`` is the card
    that will sit directly above the moved one, ``before_key`` the one directly below."""

    to_status_id: uuid.UUID | None = None
    sprint_id: uuid.UUID | None = None  # send null to return the issue to the backlog
    after_key: IssueKey | None = None
    before_key: IssueKey | None = None


class CreateLabelRequest(_Request):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


class LabelResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: str


class LabelListResponse(BaseModel):
    items: list[LabelResponse]
