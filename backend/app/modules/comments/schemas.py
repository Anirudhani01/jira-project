"""Comment request/response models. Requests forbid unknown fields, so server-owned
fields (id, org_id, issue_id, author_id, timestamps) are rejected with 422 (mass-
assignment protection) -- a comment PATCH can only ever change ``body``."""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

Body = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=32000)]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CreateCommentRequest(_Request):
    body: Body


class UpdateCommentRequest(_Request):
    body: Body


class UserRef(BaseModel):
    id: uuid.UUID
    display_name: str


class CommentResponse(BaseModel):
    id: uuid.UUID
    issue_key: str
    author: UserRef
    body: str
    body_html: str
    edited_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CommentListResponse(BaseModel):
    items: list[CommentResponse]
    next_cursor: str | None
