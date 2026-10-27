"""Data access for organizations, memberships, seeded configuration and audit reads.

Every query runs under RLS as the runtime role. Membership lookups always use the bound
user (``app_current_user()``), never a caller-supplied id. Tenant-scoped functions first
call ``require_org_context`` so they refuse to run without a bound org (fail closed).
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import Row, and_, func, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.audit.models import AuditEvent
from app.modules.orgs.models import IssueType, Organization, OrgMembership, Priority
from app.modules.orgs.seeds import ISSUE_TYPES, PRIORITIES


@dataclass(frozen=True, slots=True)
class MembershipRow:
    org_id: uuid.UUID
    slug: str
    name: str
    role: str
    can_create_projects: bool


def _membership_query() -> Any:
    return (
        select(
            Organization.id.label("org_id"),
            Organization.slug,
            Organization.name,
            OrgMembership.role,
            OrgMembership.can_create_projects,
        )
        .join(OrgMembership, OrgMembership.org_id == Organization.id)
        .where(
            OrgMembership.user_id == func.app_current_user(),
            OrgMembership.removed_at.is_(None),
        )
    )


def _row(row: Row[Any]) -> MembershipRow:
    return MembershipRow(
        org_id=row.org_id,
        slug=row.slug,
        name=row.name,
        role=row.role,
        can_create_projects=row.can_create_projects,
    )


# ----------------------------------------------------------------- membership lookups
async def find_active_membership_by_slug(session: AsyncSession, slug: str) -> MembershipRow | None:
    """Resolve a slug through the bound user's active membership (case-insensitive)."""
    row = (
        await session.execute(_membership_query().where(Organization.slug == slug))
    ).one_or_none()
    return _row(row) if row is not None else None


async def find_active_membership(session: AsyncSession, org_id: uuid.UUID) -> MembershipRow | None:
    context = require_org_context(session)
    if context.org_id != org_id:
        return None
    row = (
        await session.execute(_membership_query().where(Organization.id == org_id))
    ).one_or_none()
    return _row(row) if row is not None else None


async def list_my_orgs(session: AsyncSession) -> list[MembershipRow]:
    rows = (await session.execute(_membership_query().order_by(Organization.slug))).all()
    return [_row(r) for r in rows]


# ------------------------------------------------------------------------- creation
async def create_org_with_owner(
    session: AsyncSession, *, org_id: uuid.UUID, slug: str, name: str, owner_id: uuid.UUID
) -> None:
    """Organization, initial owner membership and seeded configuration, in the caller's
    transaction (bound to ``org_id``). The deferred ``org_has_owner`` trigger rejects the
    commit if the owner row is missing."""
    require_org_context(session)
    await session.execute(
        insert(Organization).values(id=org_id, slug=slug, name=name, created_by=owner_id)
    )
    await session.execute(
        insert(OrgMembership).values(org_id=org_id, user_id=owner_id, role="owner")
    )
    await session.execute(
        insert(IssueType),
        [
            {"org_id": org_id, "name": type_name, "kind": kind, "position": index}
            for index, (type_name, kind) in enumerate(ISSUE_TYPES)
        ],
    )
    await session.execute(
        insert(Priority),
        [
            {"org_id": org_id, "name": priority, "sort_order": index, "color": color}
            for index, (priority, color) in enumerate(PRIORITIES)
        ],
    )


# ------------------------------------------------------------------- org operations
@dataclass(frozen=True, slots=True)
class OrgRecord:
    id: uuid.UUID
    slug: str
    name: str
    created_at: datetime


async def get_org(session: AsyncSession) -> OrgRecord:
    context = require_org_context(session)
    row = (
        await session.execute(
            select(
                Organization.id, Organization.slug, Organization.name, Organization.created_at
            ).where(Organization.id == context.org_id)
        )
    ).one()
    return OrgRecord(id=row.id, slug=row.slug, name=row.name, created_at=row.created_at)


async def rename_org(session: AsyncSession, name: str) -> bool:
    context = require_org_context(session)
    result = await session.execute(
        update(Organization)
        .where(Organization.id == context.org_id, Organization.name != name)
        .values(name=name, updated_at=func.now())
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def list_issue_types(session: AsyncSession) -> list[IssueType]:
    context = require_org_context(session)
    result = await session.execute(
        select(IssueType).where(IssueType.org_id == context.org_id).order_by(IssueType.position)
    )
    return list(result.scalars())


async def list_priorities(session: AsyncSession) -> list[Priority]:
    context = require_org_context(session)
    result = await session.execute(
        select(Priority).where(Priority.org_id == context.org_id).order_by(Priority.sort_order)
    )
    return list(result.scalars())


# --------------------------------------------------------------------- audit reads
@dataclass(frozen=True, slots=True)
class AuditFilter:
    action: str | None = None
    actor_user_id: uuid.UUID | None = None
    created_from: datetime | None = None
    created_to: datetime | None = None


async def list_audit_events(
    session: AsyncSession,
    filters: AuditFilter,
    *,
    limit: int,
    after: tuple[datetime, int] | None,
) -> list[AuditEvent]:
    """Newest first; ``after`` is the (created_at, id) of the last row already returned."""
    context = require_org_context(session)
    conditions: list[Any] = [AuditEvent.org_id == context.org_id]
    if filters.action:
        conditions.append(AuditEvent.action == filters.action)
    if filters.actor_user_id:
        conditions.append(AuditEvent.actor_user_id == filters.actor_user_id)
    if filters.created_from:
        conditions.append(AuditEvent.created_at >= filters.created_from)
    if filters.created_to:
        conditions.append(AuditEvent.created_at < filters.created_to)
    if after is not None:
        created_at, event_id = after
        conditions.append(
            or_(
                AuditEvent.created_at < created_at,
                and_(AuditEvent.created_at == created_at, AuditEvent.id < event_id),
            )
        )
    result = await session.execute(
        select(AuditEvent)
        .where(*conditions)
        .order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .limit(limit)
    )
    return list(result.scalars())
