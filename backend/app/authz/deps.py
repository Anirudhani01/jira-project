"""Membership resolution and permission checks for org routes (plan §4.2/§4.3, V2.6).

- ``{org_slug}`` is resolved once per request *through the caller's active membership*.
  Unknown slug, no membership and removed membership all produce the same 404.
- The tenant context (org id) comes only from that resolution, never from request data.
- ``require(permission)`` is the only way an org route declares access (tagged; enforced
  for every route by ``tests/unit/test_route_guards.py``). Member lacking a permission:
  403; anyone else: 404.
- ``org_transaction`` binds the context for the handler's own transaction and re-checks
  the membership and permission inside it, so a membership removed after resolution is
  honoured by the next statement, not just the next request.
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, replace
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.permissions import Permission, org_permissions
from app.core.errors import AppError
from app.db.tenant import TenantContext, bind_tenant
from app.modules.identity.deps import CurrentSession, IdentityServices, Services
from app.modules.orgs import repository
from app.modules.orgs.slugs import is_well_formed_slug

AUTHZ_ATTRIBUTE = "__authz_permission__"


@dataclass(frozen=True, slots=True)
class OrgAccess:
    org_id: uuid.UUID
    user_id: uuid.UUID
    slug: str
    role: str
    can_create_projects: bool
    permissions: frozenset[Permission]


def not_found() -> AppError:
    """The single response for every inaccessible org resource (V2.6)."""
    return AppError(404, "not_found")


def forbidden() -> AppError:
    return AppError(403, "forbidden", "You do not have permission to do this.")


def _access(membership: repository.MembershipRow, user_id: uuid.UUID) -> OrgAccess:
    return OrgAccess(
        org_id=membership.org_id,
        user_id=user_id,
        slug=membership.slug,
        role=membership.role,
        can_create_projects=membership.can_create_projects,
        permissions=org_permissions(
            membership.role, can_create_projects=membership.can_create_projects
        ),
    )


async def resolve_org(org_slug: str, auth: CurrentSession, services: Services) -> OrgAccess:
    if not is_well_formed_slug(org_slug):
        raise not_found()
    async with services.sessionmaker() as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=None, user_id=auth.user_id))
        membership = await repository.find_active_membership_by_slug(session, org_slug)
    if membership is None:
        raise not_found()
    return _access(membership, auth.user_id)


def require(permission: Permission) -> Any:
    async def check(access: Annotated[OrgAccess, Depends(resolve_org)]) -> OrgAccess:
        if permission not in access.permissions:
            raise forbidden()
        return access

    setattr(check, AUTHZ_ATTRIBUTE, permission)
    return Depends(check)


@asynccontextmanager
async def org_transaction(
    services: IdentityServices, access: OrgAccess, permission: Permission
) -> AsyncIterator[tuple[AsyncSession, OrgAccess]]:
    """Open the handler's transaction bound to the org, re-verifying access inside it."""
    async with services.sessionmaker() as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=access.org_id, user_id=access.user_id))
        membership = await repository.find_active_membership(session, access.org_id)
        if membership is None:
            raise not_found()
        current = replace(_access(membership, access.user_id), slug=access.slug)
        if permission not in current.permissions:
            raise forbidden()
        yield session, current
