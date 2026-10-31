"""Comment use cases (plan M8, R4, R7-M8).

- Every operation runs in ONE transaction that re-checks the caller's project access
  (``project_transaction``), exactly like issues (M6/M7): comments of issues the caller
  cannot view are 404, the same as an unknown comment.
- Create: optional ``Idempotency-Key``, reusing the generic ``idempotency_keys`` table and
  its repository functions from the issues module (plan R3.3 row 24 -- the table was never
  issue-specific, just the canonical hash each caller builds is route-bound).
- Author-vs-permission decision for edit/delete is made here, not in a single fixed-
  permission route dependency (mirrors M7's ``issue.assign`` compound check):
  - **edit** (``PATCH``): author only, and only while they still hold ``comment.edit_own``
    (an active project admin/member role -- not viewer, not removed).
  - **delete** (``DELETE``): the author under the *same* condition as edit, OR anyone
    holding ``comment.delete_any`` (org owner/admin, or a project admin). An author who has
    been demoted to viewer or removed from the project cannot delete through the author
    path -- only through someone else's ``delete_any``.
  Both checks are re-evaluated on every call from the live, current membership/role, never
  from anything cached on the resolved reference.
- Markdown is rendered and sanitized on every read (``app.core.markdown``), never stored:
  the ``comments`` table has no HTML column, matching the plan's documented schema exactly.
"""

import base64
import binascii
import hashlib
import json
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.comments import CommentRef
from app.authz.deps import forbidden, not_found
from app.authz.issues import IssueRef
from app.authz.permissions import Permission
from app.authz.projects import project_transaction
from app.core.errors import AppError
from app.core.markdown import render_comment_body
from app.modules.comments import repository
from app.modules.comments.schemas import (
    CommentResponse,
    CreateCommentRequest,
    UpdateCommentRequest,
    UserRef,
)
from app.modules.identity.deps import IdentityServices
from app.modules.identity.directory import visible_users
from app.modules.issues import repository as issues
from app.modules.notifications import service as notifications
from app.modules.projects.service import project_archived

FORMER_MEMBER = "Former member"


def invalid_cursor() -> AppError:
    return AppError(400, "invalid_cursor", "The cursor is invalid for this request.")


def _response(row: Any, users: dict[uuid.UUID, Any]) -> CommentResponse:
    comment = row.Comment
    author = users.get(comment.author_id)
    return CommentResponse(
        id=comment.id,
        issue_key=f"{row.project_key}-{row.seq}",
        author=UserRef(
            id=comment.author_id,
            display_name=author.display_name if author else FORMER_MEMBER,
        ),
        body=comment.body,
        body_html=render_comment_body(comment.body),
        edited_at=comment.edited_at,
        created_at=comment.created_at,
        updated_at=comment.updated_at,
    )


async def _responses(session: AsyncSession, rows: list[Any]) -> list[CommentResponse]:
    users = await visible_users(session, sorted({r.Comment.author_id for r in rows}))
    return [_response(r, users) for r in rows]


async def _comment_response(session: AsyncSession, comment_id: uuid.UUID) -> CommentResponse:
    [response] = await _responses(session, [await repository.comment_view(session, comment_id)])
    return response


# --------------------------------------------------------------------------- create
@dataclass(frozen=True, slots=True)
class Created:
    comment: CommentResponse
    replayed: bool


def request_hash(issue_key: str, body: CreateCommentRequest) -> bytes:
    """Binds an idempotency key to the exact request (route, issue and body)."""
    canonical = json.dumps(
        {"route": "comments.create", "issue": issue_key, "body": body.model_dump(mode="json")},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).digest()


def _in_progress() -> AppError:
    return AppError(
        409, "idempotency_in_progress", "The original request is still in progress. Retry."
    )


async def create_comment(
    services: IdentityServices,
    ref: IssueRef,
    body: CreateCommentRequest,
    idempotency_key: str | None,
) -> Created:
    async with project_transaction(services, ref.project, Permission.COMMENT_CREATE) as (
        session,
        project,
        current,
    ):
        if project.archived_at is not None:
            raise project_archived()
        issue = await issues.find_issue(session, project.id, ref.seq)
        if issue is None:
            raise not_found()
        if idempotency_key is not None:
            fingerprint = request_hash(ref.key, body)
            if not await issues.claim_idempotency_key(session, idempotency_key, fingerprint):
                # Access was re-checked above in this transaction, so a replay never
                # discloses a comment to a caller who lost access since (plan R4,
                # decision 5, carried over from the identical M6 issue-create rule).
                stored = await issues.find_idempotency_key(session, idempotency_key)
                if stored is None or stored.response_body is None:
                    raise _in_progress()
                if stored.request_hash != fingerprint:
                    raise AppError(
                        422,
                        "idempotency_key_reused",
                        "This Idempotency-Key was already used for a different request.",
                    )
                return Created(CommentResponse.model_validate(stored.response_body), True)
        comment_id = uuid.uuid4()
        await repository.insert_comment(
            session, comment_id, issue.id, current.org.user_id, body.body
        )
        await notifications.notify(
            session,
            project_id=project.id,
            issue_id=issue.id,
            kind="issue_commented",
            candidates=[issue.reporter_id, issue.assignee_id],
            payload={"summary": issue.summary, "comment_id": str(comment_id)},
        )
        response = await _comment_response(session, comment_id)
        if idempotency_key is not None:
            await issues.store_idempotent_response(
                session, idempotency_key, 201, response.model_dump(mode="json")
            )
        return Created(response, False)


# ----------------------------------------------------------------------- read / list
def encode_cursor(value: datetime, last_id: uuid.UUID) -> str:
    raw = json.dumps([value.isoformat(), str(last_id)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        value, last_id = json.loads(raw)
        return datetime.fromisoformat(value), uuid.UUID(last_id)
    except (ValueError, TypeError, binascii.Error) as error:
        raise invalid_cursor() from error


async def list_comments(
    services: IdentityServices, ref: IssueRef, cursor: str | None, limit: int
) -> tuple[list[CommentResponse], str | None]:
    after = decode_cursor(cursor) if cursor else None
    async with project_transaction(services, ref.project, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        issue = await issues.find_issue(session, project.id, ref.seq)
        if issue is None:
            raise not_found()
        rows = await repository.list_comments(session, issue.id, after=after, limit=limit + 1)
        items = await _responses(session, rows[:limit])
    next_cursor = None
    if len(rows) > limit:
        last = rows[limit - 1].Comment
        next_cursor = encode_cursor(last.created_at, last.id)
    return items, next_cursor


# --------------------------------------------------------------------------- update
async def update_comment(
    services: IdentityServices, ref: CommentRef, body: UpdateCommentRequest
) -> CommentResponse:
    async with project_transaction(services, ref.project, Permission.PROJECT_VIEW) as (
        session,
        project,
        current,
    ):
        if project.archived_at is not None:
            raise project_archived()
        comment = await repository.find_comment(session, ref.comment_id)
        if comment is None:
            raise not_found()
        if (
            comment.author_id != current.org.user_id
            or Permission.COMMENT_EDIT_OWN not in current.permissions
        ):
            raise forbidden()
        if not await repository.update_body(session, comment.id, current.org.user_id, body.body):
            raise not_found()
        return await _comment_response(session, comment.id)


# --------------------------------------------------------------------------- delete
async def delete_comment(services: IdentityServices, ref: CommentRef) -> None:
    async with project_transaction(services, ref.project, Permission.PROJECT_VIEW) as (
        session,
        project,
        current,
    ):
        if project.archived_at is not None:
            raise project_archived()
        comment = await repository.find_comment(session, ref.comment_id)
        if comment is None:
            raise not_found()
        is_author_eligible = (
            comment.author_id == current.org.user_id
            and Permission.COMMENT_EDIT_OWN in current.permissions
        )
        is_admin = Permission.COMMENT_DELETE_ANY in current.permissions
        if not (is_author_eligible or is_admin):
            raise forbidden()
        if not await repository.soft_delete(session, comment.id):
            raise not_found()
