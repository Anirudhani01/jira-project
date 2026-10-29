"""Data access for comments (M8).

All functions require a bound org context (``require_org_context``) and run under RLS,
which additionally hides comments of issues/projects the caller cannot view (the
``comments_select`` policy follows its issue, exactly like ``issue_activity``).
"""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import and_, func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.comments.models import Comment
from app.modules.issues.models import Issue
from app.modules.projects.models import Project

NOT_DELETED = Comment.deleted_at.is_(None)


async def insert_comment(
    session: AsyncSession,
    comment_id: uuid.UUID,
    issue_id: uuid.UUID,
    author_id: uuid.UUID,
    body: str,
) -> None:
    context = require_org_context(session)
    await session.execute(
        insert(Comment).values(
            id=comment_id,
            org_id=context.org_id,
            issue_id=issue_id,
            author_id=author_id,
            body=body,
        )
    )


async def find_comment(session: AsyncSession, comment_id: uuid.UUID) -> Comment | None:
    """A live (not soft-deleted) comment; ``None`` also when RLS hides it."""
    context = require_org_context(session)
    return (
        await session.execute(
            select(Comment).where(
                Comment.org_id == context.org_id, Comment.id == comment_id, NOT_DELETED
            )
        )
    ).scalar_one_or_none()


async def find_comment_issue_ref(session: AsyncSession, comment_id: uuid.UUID) -> Any:
    """The comment's issue key and project key, to resolve project access for the
    ``PATCH``/``DELETE /comments/{id}`` routes (not nested under an issue key in the URL).
    ``None`` if unknown, deleted, or hidden by RLS."""
    context = require_org_context(session)
    return (
        await session.execute(
            select(
                Comment.id,
                Comment.author_id,
                Issue.seq,
                Project.key.label("project_key"),
            )
            .join(Issue, Issue.id == Comment.issue_id)
            .join(Project, Project.id == Issue.project_id)
            .where(Comment.org_id == context.org_id, Comment.id == comment_id, NOT_DELETED)
        )
    ).one_or_none()


def _view_query() -> Any:
    return (
        select(Comment, Project.key.label("project_key"), Issue.seq)
        .join(Issue, Issue.id == Comment.issue_id)
        .join(Project, Project.id == Issue.project_id)
    )


async def comment_view(session: AsyncSession, comment_id: uuid.UUID) -> Any:
    context = require_org_context(session)
    return (
        await session.execute(
            _view_query().where(Comment.org_id == context.org_id, Comment.id == comment_id)
        )
    ).one()


async def list_comments(
    session: AsyncSession,
    issue_id: uuid.UUID,
    *,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Any]:
    """Chronological, keyset-paginated by ``(created_at, id)``: ``id`` (a UUID, unique
    and stable, though not itself time-ordered) breaks ties deterministically when two
    comments share a ``created_at`` -- the same pattern as the issue list (plan M8 AC:
    timeline ordering must be deterministic)."""
    context = require_org_context(session)
    conditions = [Comment.org_id == context.org_id, Comment.issue_id == issue_id, NOT_DELETED]
    if after is not None:
        value, last_id = after
        conditions.append(
            or_(Comment.created_at > value, and_(Comment.created_at == value, Comment.id > last_id))
        )
    return list(
        await session.execute(
            _view_query()
            .where(*conditions)
            .order_by(Comment.created_at.asc(), Comment.id.asc())
            .limit(limit)
        )
    )


async def update_body(
    session: AsyncSession, comment_id: uuid.UUID, author_id: uuid.UUID, body: str
) -> bool:
    """Edit is always author-scoped at this layer too (defense in depth beyond the
    service-layer permission check and the RLS backstop): the ``WHERE`` clause itself
    only ever matches the author's own, still-live comment."""
    context = require_org_context(session)
    result = await session.execute(
        update(Comment)
        .where(
            Comment.org_id == context.org_id,
            Comment.id == comment_id,
            Comment.author_id == author_id,
            NOT_DELETED,
        )
        .values(body=body, edited_at=func.now(), updated_at=func.now())
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def soft_delete(session: AsyncSession, comment_id: uuid.UUID) -> bool:
    """The author-vs-admin distinction is resolved by the service layer before this is
    called; this only requires the row to still be live, with RLS as the backstop."""
    context = require_org_context(session)
    result = await session.execute(
        update(Comment)
        .where(Comment.org_id == context.org_id, Comment.id == comment_id, NOT_DELETED)
        .values(deleted_at=func.now())
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]
