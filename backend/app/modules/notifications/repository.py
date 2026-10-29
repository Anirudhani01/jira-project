"""Notification data access (M11). Reads and updates run under RLS: only the bound user's
own notifications are ever visible."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.issues.models import Issue
from app.modules.notifications.models import Notification
from app.modules.orgs.models import OrgMembership
from app.modules.projects.models import Project, ProjectMembership


async def eligible_recipients(
    session: AsyncSession, project_id: uuid.UUID, candidates: list[uuid.UUID]
) -> set[uuid.UUID]:
    """Candidates who are active org members able to view the project: org owners/admins
    (implicit project admins) or project members (plan R3.3 row 22)."""
    if not candidates:
        return set()
    context = require_org_context(session)
    rows = await session.execute(
        select(OrgMembership.user_id).where(
            OrgMembership.org_id == context.org_id,
            OrgMembership.user_id.in_(candidates),
            OrgMembership.removed_at.is_(None),
            (OrgMembership.role.in_(("owner", "admin")))
            | OrgMembership.user_id.in_(
                select(ProjectMembership.user_id).where(
                    ProjectMembership.org_id == context.org_id,
                    ProjectMembership.project_id == project_id,
                )
            ),
        )
    )
    return {user_id for (user_id,) in rows}


async def insert_notifications(session: AsyncSession, rows: list[dict[str, Any]]) -> None:
    context = require_org_context(session)
    if rows:
        await session.execute(
            insert(Notification),
            [{"org_id": context.org_id, "actor_id": context.user_id, **row} for row in rows],
        )


def _own_rows() -> Any:
    return select(Notification, Issue.seq, Project.key.label("project_key"))


async def list_notifications(
    session: AsyncSession,
    *,
    unread_only: bool,
    after: tuple[datetime, uuid.UUID] | None,
    limit: int,
) -> list[Any]:
    context = require_org_context(session)
    query = (
        _own_rows()
        .join(Issue, Issue.id == Notification.issue_id)
        .join(Project, Project.id == Issue.project_id)
        .where(
            Notification.org_id == context.org_id,
            Notification.recipient_id == context.user_id,
        )
    )
    if unread_only:
        query = query.where(Notification.read_at.is_(None))
    if after is not None:
        value, last_id = after
        query = query.where(
            (Notification.created_at < value)
            | ((Notification.created_at == value) & (Notification.id < last_id))
        )
    return list(
        await session.execute(
            query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit)
        )
    )


async def unread_count(session: AsyncSession) -> int:
    context = require_org_context(session)
    return int(
        (
            await session.execute(
                select(func.count())
                .select_from(Notification)
                .where(
                    Notification.org_id == context.org_id,
                    Notification.recipient_id == context.user_id,
                    Notification.read_at.is_(None),
                )
            )
        ).scalar_one()
    )


async def mark_read(session: AsyncSession, notification_id: uuid.UUID | None) -> int:
    """Marks one notification (or every unread one when ``None``) read; returns the number
    of rows that changed."""
    context = require_org_context(session)
    query = update(Notification).where(
        Notification.org_id == context.org_id,
        Notification.recipient_id == context.user_id,
        Notification.read_at.is_(None),
    )
    if notification_id is not None:
        query = query.where(Notification.id == notification_id)
    result = await session.execute(query.values(read_at=func.now()))
    return int(result.rowcount)  # type: ignore[attr-defined]


async def exists(session: AsyncSession, notification_id: uuid.UUID) -> bool:
    context = require_org_context(session)
    return (
        await session.execute(
            select(Notification.id).where(
                Notification.org_id == context.org_id,
                Notification.recipient_id == context.user_id,
                Notification.id == notification_id,
            )
        )
    ).scalar_one_or_none() is not None
