"""Project resolution and permission checks (M5, plan §4.2/§4.3).

``{project_key}`` is resolved inside the caller's org (already resolved through their
active membership). A project is visible to org owners/admins and to its project
members; everyone else gets the same 404 as for an unknown project. The handler
transaction re-checks the project role and permission (``project_transaction``).
"""

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import (
    AUTHZ_ATTRIBUTE,
    OrgAccess,
    forbidden,
    not_found,
    org_transaction,
    resolve_org,
)
from app.authz.permissions import Permission, project_permissions
from app.modules.identity.deps import IdentityServices, Services
from app.modules.projects import repository
from app.modules.projects.models import Project


@dataclass(frozen=True, slots=True)
class ProjectAccess:
    org: OrgAccess
    project_id: uuid.UUID
    key: str
    project_role: str | None
    permissions: frozenset[Permission]


def _visible(org: OrgAccess, project_role: str | None) -> bool:
    return org.role in ("owner", "admin") or project_role is not None


async def resolve_project(
    project_key: str,
    org: Annotated[OrgAccess, Depends(resolve_org)],
    services: Services,
) -> ProjectAccess:
    if len(project_key) > 10:
        raise not_found()
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, current):
        project = await repository.find_project(session, project_key)
        if project is None:
            raise not_found()
        role = await repository.my_project_role(session, project.id)
    if not _visible(current, role):
        raise not_found()
    return ProjectAccess(
        org=current,
        project_id=project.id,
        key=project.key,
        project_role=role,
        permissions=project_permissions(current.role, role),
    )


def require_project(permission: Permission) -> Any:
    async def check(access: Annotated[ProjectAccess, Depends(resolve_project)]) -> ProjectAccess:
        if permission not in access.permissions:
            raise forbidden()
        return access

    setattr(check, AUTHZ_ATTRIBUTE, permission)
    return Depends(check)


@asynccontextmanager
async def project_transaction(
    services: IdentityServices, access: ProjectAccess, permission: Permission
) -> AsyncIterator[tuple[AsyncSession, Project, ProjectAccess]]:
    """Org transaction plus an in-transaction re-check of the project role."""
    async with org_transaction(services, access.org, Permission.ORG_VIEW) as (session, org):
        project = await repository.find_project(session, access.key)
        if project is None or project.id != access.project_id:
            raise not_found()
        role = await repository.my_project_role(session, project.id)
        if not _visible(org, role):
            raise not_found()
        current = ProjectAccess(
            org=org,
            project_id=project.id,
            key=project.key,
            project_role=role,
            permissions=project_permissions(org.role, role),
        )
        if permission not in current.permissions:
            raise forbidden()
        yield session, project, current
