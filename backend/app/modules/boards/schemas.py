"""Board request/response models (M9)."""

import uuid
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.modules.issues.schemas import IssueResponse

ColumnName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class ColumnInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None
    name: ColumnName
    wip_limit: int | None = Field(default=None, ge=1, le=1000)
    status_ids: list[uuid.UUID] = Field(max_length=50)


class ReplaceColumnsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[ColumnInput] = Field(min_length=1, max_length=20)


class BoardTransition(BaseModel):
    from_status_id: uuid.UUID | None
    to_status_id: uuid.UUID


class BoardColumn(BaseModel):
    id: uuid.UUID
    name: str
    position: int
    wip_limit: int | None
    status_ids: list[uuid.UUID]
    count: int
    over_wip_limit: bool
    issues: list[IssueResponse]


class BoardResponse(BaseModel):
    project_key: str
    board_type: str
    columns: list[BoardColumn]
    transitions: list[BoardTransition]
    truncated: bool
