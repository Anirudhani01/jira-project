"""Saved-filter request/response models. ``params`` accepts only the issue list's own filter
keys, so arbitrary JSON can never be stored."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

FilterName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
ParamValue = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class FilterParams(BaseModel):
    """The URL parameters of the issue list; an unset key means "no filter"."""

    model_config = ConfigDict(extra="forbid")

    status_category: ParamValue | None = None
    type: ParamValue | None = None
    priority: ParamValue | None = None
    assignee: ParamValue | None = None
    tester: ParamValue | None = None
    label: ParamValue | None = None
    sprint: ParamValue | None = None
    q: ParamValue | None = None
    sort: ParamValue | None = None

    def stored(self) -> dict[str, str]:
        return self.model_dump(exclude_none=True)


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateSavedFilterRequest(_Request):
    name: FilterName
    params: FilterParams

    @model_validator(mode="after")
    def _not_empty(self) -> "CreateSavedFilterRequest":
        if not self.params.stored():
            raise ValueError("params must contain at least one filter")
        return self


class UpdateSavedFilterRequest(_Request):
    name: FilterName | None = None
    params: FilterParams | None = None

    @model_validator(mode="after")
    def _something(self) -> "UpdateSavedFilterRequest":
        if self.name is None and self.params is None:
            raise ValueError("name or params is required")
        if self.params is not None and not self.params.stored():
            raise ValueError("params must contain at least one filter")
        return self


class SavedFilterResponse(BaseModel):
    id: uuid.UUID
    name: str
    params: dict[str, str]
    created_at: datetime
    updated_at: datetime


class SavedFilterListResponse(BaseModel):
    items: list[SavedFilterResponse] = Field(default_factory=list)
