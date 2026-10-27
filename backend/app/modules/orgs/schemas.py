"""Organization request/response models. Requests forbid unknown fields."""

import uuid
from datetime import datetime
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.modules.orgs.models import MAX_ORG_NAME_LENGTH
from app.modules.orgs.slugs import is_well_formed_slug


def _validate_slug(value: str) -> str:
    value = value.strip().lower()
    if not is_well_formed_slug(value):
        raise ValueError(
            "must be 2-39 characters: lowercase letters, digits and hyphens, "
            "starting with a letter or digit"
        )
    return value


Slug = Annotated[str, Field(max_length=64), AfterValidator(_validate_slug)]
OrgName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_ORG_NAME_LENGTH)
]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateOrgRequest(_Request):
    slug: Slug
    name: OrgName


class UpdateOrgRequest(_Request):
    name: OrgName | None = None
    # Accepted only so it can be rejected with `field_immutable` (V2.9); never applied.
    slug: Any = Field(default=None, json_schema_extra={"readOnly": True})


class OrgSummary(BaseModel):
    slug: str
    name: str
    role: str


class OrgListResponse(BaseModel):
    items: list[OrgSummary]


class OrgResponse(BaseModel):
    id: uuid.UUID
    slug: str
    name: str
    role: str
    permissions: list[str]
    created_at: datetime


class IssueTypeResponse(BaseModel):
    id: uuid.UUID
    name: str
    kind: str
    position: int


class IssueTypeListResponse(BaseModel):
    items: list[IssueTypeResponse]


class PriorityResponse(BaseModel):
    id: uuid.UUID
    name: str
    sort_order: int
    color: str


class PriorityListResponse(BaseModel):
    items: list[PriorityResponse]


class AuditEventResponse(BaseModel):
    id: int
    action: str
    actor_user_id: uuid.UUID | None
    target_type: str | None
    target_id: str | None
    outcome: str
    ip: str | None
    user_agent: str | None
    request_id: str | None
    metadata: dict[str, Any]
    created_at: datetime


class AuditEventListResponse(BaseModel):
    items: list[AuditEventResponse]
    next_cursor: str | None
