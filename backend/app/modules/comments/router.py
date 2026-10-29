"""Comment HTTP API (M8). Two route groups, per the plan's own endpoint table: comments
are listed/created nested under their issue (``/issues/{issue_key}/comments``), but
edited/deleted directly by id (``/comments/{comment_id}``) -- not nested under the issue
key, since a comment's id alone identifies it."""

import re
from typing import Annotated

from fastapi import APIRouter, Header, Query, Response, status

from app.authz.comments import CommentRef, require_comment
from app.authz.issues import IssueRef, require_issue
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.modules.comments import service
from app.modules.comments.schemas import (
    CommentListResponse,
    CommentResponse,
    CreateCommentRequest,
    UpdateCommentRequest,
)
from app.modules.identity.deps import CsrfProtected, Services

router = APIRouter(prefix="/api/v1/orgs/{org_slug}", tags=["comments"])

ViewIssueComments = Annotated[IssueRef, require_issue(Permission.PROJECT_VIEW)]
CreateComments = Annotated[IssueRef, require_issue(Permission.COMMENT_CREATE)]
ViewComment = Annotated[CommentRef, require_comment(Permission.PROJECT_VIEW)]

IDEMPOTENCY_KEY_RE = re.compile(r"[A-Za-z0-9_.:-]{1,64}")


@router.post(
    "/issues/{issue_key}/comments",
    status_code=status.HTTP_201_CREATED,
    response_model=CommentResponse,
    dependencies=[CsrfProtected],
)
async def create_comment(
    body: CreateCommentRequest,
    ref: CreateComments,
    services: Services,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> CommentResponse:
    """``Idempotency-Key`` (optional): a retry with the same key and body replays the
    original response, exactly like issue creation."""
    if idempotency_key is not None and not IDEMPOTENCY_KEY_RE.fullmatch(idempotency_key):
        raise AppError(
            422,
            "validation_error",
            "Idempotency-Key must be 1-64 characters: letters, digits, _ . : -",
            errors=[{"field": "header.idempotency-key", "message": "invalid format"}],
        )
    created = await service.create_comment(services, ref, body, idempotency_key)
    return created.comment


@router.get("/issues/{issue_key}/comments", response_model=CommentListResponse)
async def list_comments(
    ref: ViewIssueComments,
    services: Services,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> CommentListResponse:
    items, next_cursor = await service.list_comments(services, ref, cursor, limit)
    return CommentListResponse(items=items, next_cursor=next_cursor)


@router.patch(
    "/comments/{comment_id}", response_model=CommentResponse, dependencies=[CsrfProtected]
)
async def update_comment(
    body: UpdateCommentRequest, ref: ViewComment, services: Services
) -> CommentResponse:
    return await service.update_comment(services, ref, body)


@router.delete(
    "/comments/{comment_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfProtected]
)
async def delete_comment(ref: ViewComment, services: Services) -> Response:
    await service.delete_comment(services, ref)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
