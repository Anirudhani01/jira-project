"""Issue request/response models. Requests forbid unknown fields, so server-owned fields
(key, status, version, org, ...) are rejected with 422 (mass-assignment protection).
Status changes only through the transitions endpoints (M7); ``status_id`` is never
accepted on create or update. Reporter is set on create; it may be changed on update."""

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

Summary = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
Description = Annotated[str, StringConstraints(max_length=32000)]
StoryPoints = Annotated[int, Field(ge=0, le=100, strict=True)]
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
    story_points: StoryPoints | None = None
    fix_version_id: uuid.UUID | None = None


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
    story_points: StoryPoints | None = None  # send null to clear
    fix_version_id: uuid.UUID | None = None  # send null to clear


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


class VersionRef(BaseModel):
    id: uuid.UUID
    name: str
    status: str


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
    fix_version: VersionRef | None
    story_points: int | None
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


class EpicResponse(BaseModel):
    id: uuid.UUID
    key: str
    summary: str
    status: StatusRef
    done: int
    total: int


class EpicListResponse(BaseModel):
    items: list[EpicResponse]


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


BULK_MAX = 100
BULK_ACTIONS = Literal[
    "move_sprint", "assign", "set_priority", "set_parent", "set_fix_version", "delete"
]
_BULK_FIELD = {
    "move_sprint": "sprint_id",
    "assign": "assignee_id",
    "set_priority": "priority_id",
    "set_parent": "parent_id",
    "set_fix_version": "fix_version_id",
}


class BulkIssueRequest(_Request):
    """One action applied to up to ``BULK_MAX`` issues. The field matching the action must be
    sent (``null`` means backlog / unassign / detach / clear); no other value field may be."""

    keys: list[IssueKey] = Field(min_length=1, max_length=BULK_MAX)
    action: BULK_ACTIONS
    sprint_id: uuid.UUID | None = None
    assignee_id: uuid.UUID | None = None
    priority_id: uuid.UUID | None = None
    parent_id: uuid.UUID | None = None
    fix_version_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _shape(self) -> "BulkIssueRequest":
        if len({key.upper() for key in self.keys}) != len(self.keys):
            raise ValueError("keys must be unique")
        wanted = _BULK_FIELD.get(self.action)
        sent = self.model_fields_set & set(_BULK_FIELD.values())
        if sent != ({wanted} if wanted else set()):
            raise ValueError(
                f"action {self.action} takes {wanted} only"
                if wanted
                else "delete takes no value field"
            )
        if self.action == "set_priority" and self.priority_id is None:
            raise ValueError("priority_id is required")
        return self


class BulkItemResult(BaseModel):
    key: str
    ok: bool
    code: str | None = None
    message: str | None = None


class BulkIssueResponse(BaseModel):
    results: list[BulkItemResult]
    succeeded: int
    failed: int


class CreateLabelRequest(_Request):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
    color: Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]


class LabelResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: str


class LabelListResponse(BaseModel):
    items: list[LabelResponse]
