"""Organization use cases (plan M3, V2.6, D1, D9).

- Creating an org requires a verified email (D1) and writes the organization, the
  creator's owner membership, the seeded issue types and priorities and the
  ``org.created`` audit event in ONE transaction; any failure rolls back all of it, and
  the deferred ``org_has_owner`` trigger guarantees an org never commits without an owner.
- Slugs are unique (case-insensitive), immutable and never authorize anything.
- The org id is generated here and bound as the tenant context before any insert; it is
  never taken from the request.
"""

import base64
import binascii
import json
import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.exc import IntegrityError

from app.authz.deps import OrgAccess, org_transaction
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.core.rate_limit import ORG_CREATE_PER_USER
from app.db.tenant import TenantContext, bind_tenant
from app.modules.audit import service as audit
from app.modules.audit.models import AuditEvent
from app.modules.identity import service as identity
from app.modules.identity.deps import AuthContext, IdentityServices
from app.modules.orgs import repository
from app.modules.orgs.models import IssueType, Priority
from app.modules.orgs.repository import AuditFilter, MembershipRow, OrgRecord, OrgSettingsRecord
from app.modules.orgs.settings_schemas import UpdateOrgSettingsRequest
from app.modules.orgs.slugs import is_reserved
from app.modules.security_events.service import ClientInfo


def slug_unavailable() -> AppError:
    return AppError(
        409,
        "slug_unavailable",
        "This address is not available. Choose another one.",
        errors=[{"field": "body.slug", "message": "is not available"}],
    )


@dataclass(frozen=True, slots=True)
class CreatedOrg:
    id: uuid.UUID
    slug: str
    name: str


async def create_org(
    services: IdentityServices, auth: AuthContext, *, slug: str, name: str, client: ClientInfo
) -> CreatedOrg:
    # Every attempt counts toward the per-user limit (10 per hour), successful or not.
    await identity.reserve_rate_limit(services, ORG_CREATE_PER_USER, str(auth.user_id), client)
    user = await identity.get_user(services, auth.user_id)
    if user.email_verified_at is None:
        raise AppError(
            403,
            "email_unverified",
            "Verify your email address before creating an organization.",
        )
    if is_reserved(slug):
        raise slug_unavailable()
    org_id = uuid.uuid4()
    try:
        async with services.sessionmaker() as session, session.begin():
            await bind_tenant(session, TenantContext(org_id=org_id, user_id=auth.user_id))
            await repository.create_org_with_owner(
                session, org_id=org_id, slug=slug, name=name, owner_id=auth.user_id
            )
            await audit.record(
                session,
                "org.created",
                client,
                actor_user_id=auth.user_id,
                target_type="organization",
                target_id=str(org_id),
                metadata={"slug": slug},
            )
    except IntegrityError as exc:
        if "uq_organizations_slug" in str(exc.orig):
            raise slug_unavailable() from None
        raise
    return CreatedOrg(id=org_id, slug=slug, name=name)


async def list_my_orgs(services: IdentityServices, user_id: uuid.UUID) -> list[MembershipRow]:
    async with services.sessionmaker() as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=None, user_id=user_id))
        return await repository.list_my_orgs(session)


async def get_org(services: IdentityServices, access: OrgAccess) -> tuple[OrgRecord, OrgAccess]:
    async with org_transaction(services, access, Permission.ORG_VIEW) as (session, current):
        return await repository.get_org(session), current


async def rename_org(
    services: IdentityServices, access: OrgAccess, *, name: str, client: ClientInfo
) -> tuple[OrgRecord, OrgAccess]:
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        if await repository.rename_org(session, name):
            await audit.record(
                session,
                "org.updated",
                client,
                actor_user_id=current.user_id,
                target_type="organization",
                target_id=str(current.org_id),
                metadata={"fields": "name"},
            )
        return await repository.get_org(session), current


async def get_org_settings(services: IdentityServices, access: OrgAccess) -> OrgSettingsRecord:
    async with org_transaction(services, access, Permission.ORG_VIEW) as (session, _):
        return await repository.get_organization_settings(session)


async def update_org_settings(
    services: IdentityServices,
    access: OrgAccess,
    body: UpdateOrgSettingsRequest,
    *,
    client: ClientInfo,
) -> OrgSettingsRecord:
    fields_set = body.model_fields_set
    timezone = body.timezone if "timezone" in fields_set else None
    locale = body.locale if "locale" in fields_set else None
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        record, changed = await repository.update_organization_settings(
            session, timezone=timezone, locale=locale
        )
        if changed:
            await audit.record(
                session,
                "org.settings.updated",
                client,
                actor_user_id=current.user_id,
                target_type="organization",
                target_id=str(current.org_id),
                metadata={"fields": ",".join(changed)},
            )
        return record


async def list_issue_types(services: IdentityServices, access: OrgAccess) -> list[IssueType]:
    async with org_transaction(services, access, Permission.ORG_VIEW) as (session, _):
        return await repository.list_issue_types(session)


async def list_priorities(services: IdentityServices, access: OrgAccess) -> list[Priority]:
    async with org_transaction(services, access, Permission.ORG_VIEW) as (session, _):
        return await repository.list_priorities(session)


# --------------------------------------------------------------------- audit reads
def encode_cursor(event: AuditEvent) -> str:
    raw = json.dumps([event.created_at.isoformat(), event.id]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[datetime, int]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        created_at, event_id = json.loads(base64.urlsafe_b64decode(padded))
        return datetime.fromisoformat(created_at), int(event_id)
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        raise AppError(400, "invalid_cursor", "The cursor is not valid.") from None


async def list_audit_events(
    services: IdentityServices,
    access: OrgAccess,
    filters: AuditFilter,
    *,
    limit: int,
    cursor: str | None,
) -> tuple[list[AuditEvent], str | None]:
    after = decode_cursor(cursor) if cursor else None
    async with org_transaction(services, access, Permission.ORG_AUDIT_VIEW) as (session, _):
        events = await repository.list_audit_events(session, filters, limit=limit + 1, after=after)
    page = events[:limit]
    return page, encode_cursor(page[-1]) if len(events) > limit else None
