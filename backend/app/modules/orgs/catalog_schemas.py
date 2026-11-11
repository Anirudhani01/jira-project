"""Organization catalog (issue types, priorities) request/response models."""

import uuid
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

CatalogName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
PriorityColor = Annotated[str, StringConstraints(pattern=r"^#[0-9A-Fa-f]{6}$")]
IssueTypeKind = Literal["epic", "standard", "subtask"]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateIssueTypeRequest(_Request):
    name: CatalogName
    kind: IssueTypeKind


class UpdateIssueTypeRequest(_Request):
    name: CatalogName | None = None
    is_active: bool | None = None


class ReorderIssueTypesRequest(_Request):
    ids: list[uuid.UUID] = Field(min_length=1)


class CreatePriorityRequest(_Request):
    name: CatalogName
    color: PriorityColor


class UpdatePriorityRequest(_Request):
    name: CatalogName | None = None
    color: PriorityColor | None = None
    is_active: bool | None = None


class ReorderPrioritiesRequest(_Request):
    ids: list[uuid.UUID] = Field(min_length=1)
