"""HTTP schemas for organization authentication activity."""

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

MemberStatus = Literal["active", "removed"]


class AuthenticationActivityItem(BaseModel):
    id: int
    user_id: uuid.UUID
    member_display_name: str
    member_status: MemberStatus
    event_type: str
    outcome: str
    reason: str | None
    metadata: dict[str, Any] = Field(
        description="Allowlisted metadata copied from the platform event at projection time."
    )
    occurred_at: datetime


class AuthenticationActivityListResponse(BaseModel):
    items: list[AuthenticationActivityItem]
    next_cursor: str | None
