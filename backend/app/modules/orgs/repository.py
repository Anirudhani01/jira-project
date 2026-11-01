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
from app.modules.identity.directory import visible_users
from app.modules.orgs.models import (
    IssueType,
    Organization,
    OrganizationSettings,
    OrgInvitation,
    OrgMembership,
    Priority,
)
from app.modules.orgs.seeds import ISSUE_TYPES, PRIORITIES
from app.modules.orgs.settings_defaults import DEFAULT_ORG_LOCALE, DEFAULT_ORG_TIMEZONE


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
async def seed_organization_settings(session: AsyncSession, org_id: uuid.UUID) -> None:
    """Insert default settings for a new org (caller must be owner/admin under RLS).

    Runs after the owner membership row exists so ``app_has_org_role`` allows INSERT.
    """
    require_org_context(session)
    await session.execute(
        insert(OrganizationSettings).values(
            org_id=org_id,
            timezone=DEFAULT_ORG_TIMEZONE,
            locale=DEFAULT_ORG_LOCALE,
        )
    )


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
    await seed_organization_settings(session, org_id)


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


@dataclass(frozen=True, slots=True)
class OrgSettingsRecord:
    timezone: str
    locale: str
    updated_at: datetime


async def get_organization_settings(session: AsyncSession) -> OrgSettingsRecord:
    context = require_org_context(session)
    row = (
        await session.execute(
            select(
                OrganizationSettings.timezone,
                OrganizationSettings.locale,
                OrganizationSettings.updated_at,
            ).where(OrganizationSettings.org_id == context.org_id)
        )
    ).one()
    return OrgSettingsRecord(timezone=row.timezone, locale=row.locale, updated_at=row.updated_at)


async def update_organization_settings(
    session: AsyncSession,
    *,
    timezone: str | None,
    locale: str | None,
) -> tuple[OrgSettingsRecord, list[str]]:
    """Apply a partial update; return the row and sorted changed field names (empty if no-op)."""
    current = await get_organization_settings(session)
    changed: list[str] = []
    values: dict[str, object] = {}
    if timezone is not None and timezone != current.timezone:
        changed.append("timezone")
        values["timezone"] = timezone
    if locale is not None and locale != current.locale:
        changed.append("locale")
        values["locale"] = locale
    if not changed:
        return current, []
    context = require_org_context(session)
    values["updated_at"] = func.now()
    await session.execute(
        update(OrganizationSettings)
        .where(OrganizationSettings.org_id == context.org_id)
        .values(**values)
    )
    return await get_organization_settings(session), changed


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


# ------------------------------------------------------------- M4: members (tenant)
@dataclass(frozen=True, slots=True)
class MemberRow:
    user_id: uuid.UUID
    display_name: str
    email: str
    role: str
    can_create_projects: bool
    created_at: datetime


async def lock_org(session: AsyncSession) -> None:
    """Per-org membership mutex (plan R4): serializes role changes and removals."""
    context = require_org_context(session)
    await session.execute(
        select(Organization.id).where(Organization.id == context.org_id).with_for_update()
    )


async def list_members(session: AsyncSession) -> list[MemberRow]:
    context = require_org_context(session)
    memberships = list(
        (
            await session.execute(
                select(OrgMembership)
                .where(OrgMembership.org_id == context.org_id, OrgMembership.removed_at.is_(None))
                .order_by(OrgMembership.created_at, OrgMembership.user_id)
            )
        ).scalars()
    )
    users = await visible_users(session, [m.user_id for m in memberships])
    return [
        MemberRow(
            user_id=m.user_id,
            display_name=users[m.user_id].display_name,
            email=users[m.user_id].email,
            role=m.role,
            can_create_projects=m.can_create_projects,
            created_at=m.created_at,
        )
        for m in memberships
        if m.user_id in users
    ]


async def get_member(session: AsyncSession, user_id: uuid.UUID) -> OrgMembership | None:
    """The membership row (active or removed) of ``user_id`` in the bound org."""
    context = require_org_context(session)
    return (
        await session.execute(
            select(OrgMembership).where(
                OrgMembership.org_id == context.org_id, OrgMembership.user_id == user_id
            )
        )
    ).scalar_one_or_none()


async def count_active_owners(session: AsyncSession) -> int:
    context = require_org_context(session)
    return int(
        (
            await session.execute(
                select(func.count()).where(
                    OrgMembership.org_id == context.org_id,
                    OrgMembership.role == "owner",
                    OrgMembership.removed_at.is_(None),
                )
            )
        ).scalar_one()
    )


async def update_member(session: AsyncSession, user_id: uuid.UUID, **values: Any) -> bool:
    context = require_org_context(session)
    result = await session.execute(
        update(OrgMembership)
        .where(OrgMembership.org_id == context.org_id, OrgMembership.user_id == user_id)
        .values(**values)
    )
    return bool(result.rowcount)  # type: ignore[attr-defined]


async def active_member_with_email(session: AsyncSession, email: str) -> bool:
    return any(m.email.lower() == email.lower() for m in await list_members(session))


async def insert_membership(session: AsyncSession, *, user_id: uuid.UUID, role: str) -> None:
    context = require_org_context(session)
    await session.execute(
        insert(OrgMembership).values(org_id=context.org_id, user_id=user_id, role=role)
    )


# --------------------------------------------------------- M4: invitations (tenant)
_PENDING = (OrgInvitation.accepted_at.is_(None), OrgInvitation.revoked_at.is_(None))


async def revoke_expired_invitations(session: AsyncSession, email: str) -> None:
    context = require_org_context(session)
    await session.execute(
        update(OrgInvitation)
        .where(
            OrgInvitation.org_id == context.org_id,
            OrgInvitation.email == email,
            OrgInvitation.expires_at <= func.now(),
            *_PENDING,
        )
        .values(revoked_at=func.now())
    )


async def insert_invitation(
    session: AsyncSession,
    *,
    invitation_id: uuid.UUID,
    email: str,
    role: str,
    invited_by: uuid.UUID,
    ttl_days: int,
) -> None:
    context = require_org_context(session)
    await session.execute(
        insert(OrgInvitation).values(
            id=invitation_id,
            org_id=context.org_id,
            email=email,
            role=role,
            invited_by=invited_by,
            expires_at=func.now() + func.make_interval(0, 0, 0, ttl_days),
        )
    )


async def list_pending_invitations(session: AsyncSession) -> list[Any]:
    context = require_org_context(session)
    return list(
        (
            await session.execute(
                select(
                    OrgInvitation.id,
                    OrgInvitation.email,
                    OrgInvitation.role,
                    OrgInvitation.created_at,
                    OrgInvitation.expires_at,
                    (OrgInvitation.expires_at <= func.now()).label("expired"),
                )
                .where(OrgInvitation.org_id == context.org_id, *_PENDING)
                .order_by(OrgInvitation.created_at.desc())
            )
        ).all()
    )


async def revoke_invitation(session: AsyncSession, invitation_id: uuid.UUID) -> Any:
    context = require_org_context(session)
    target = (
        await session.execute(
            select(OrgInvitation.id, OrgInvitation.role).where(
                OrgInvitation.id == invitation_id, OrgInvitation.org_id == context.org_id, *_PENDING
            )
        )
    ).one_or_none()
    if target is None:
        return None
    await session.execute(
        update(OrgInvitation).where(OrgInvitation.id == invitation_id).values(revoked_at=func.now())
    )
    return target


async def find_invitation_by_bound_token(session: AsyncSession) -> Any:
    """Requires ``bind_invite_token``: RLS exposes only that invitation."""
    return (
        await session.execute(
            select(
                OrgInvitation.id,
                OrgInvitation.org_id,
                OrgInvitation.email,
                OrgInvitation.role,
                OrgInvitation.accepted_at,
                OrgInvitation.revoked_at,
                (OrgInvitation.expires_at <= func.now()).label("expired"),
            ).where(OrgInvitation.token_hash == func.app_invite_token_hash())
        )
    ).one_or_none()


async def mark_invitation_accepted(
    session: AsyncSession, invitation_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    require_org_context(session)
    await session.execute(
        update(OrgInvitation)
        .where(OrgInvitation.id == invitation_id)
        .values(accepted_at=func.now(), accepted_by=user_id)
    )


def now() -> Any:
    return func.now()


async def remove_member_effects(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Same-transaction effects of removing a member: their project memberships go (M5)
    and their live issues are unassigned, with a version bump and activity (M6)."""
    from app.modules.issues.repository import add_activity, unassign_member  # noqa: PLC0415
    from app.modules.projects.repository import remove_user_from_all_projects  # noqa: PLC0415

    await remove_user_from_all_projects(session, user_id)
    unassigned = await unassign_member(session, user_id)
    await add_activity(
        session,
        [
            {
                "issue_id": issue_id,
                "action": "updated",
                "field": "assignee",
                "old_value": {"id": str(user_id)},
                "new_value": None,
            }
            for issue_id in unassigned
        ],
    )
