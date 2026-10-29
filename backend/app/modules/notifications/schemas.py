"""Notification response models (M11)."""

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel


class NotificationActor(BaseModel):
    id: uuid.UUID
    display_name: str


class NotificationResponse(BaseModel):
    id: uuid.UUID
    type: str
    issue_key: str
    actor: NotificationActor
    payload: dict[str, Any]
    read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    items: list[NotificationResponse]
    next_cursor: str | None


class UnreadCountResponse(BaseModel):
    count: int


class ReadAllResponse(BaseModel):
    updated: int
