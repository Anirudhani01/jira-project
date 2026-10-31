"""Version resolution for ``/versions/{version_id}`` routes. Same pattern as sprints: the
version is looked up under RLS (a version of an invisible project is simply unknown), then the
caller's real permissions come from its project."""

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends

from app.authz.deps import (
    AUTHZ_ATTRIBUTE,
    OrgAccess,
    forbidden,
    not_found,
    org_transaction,
    resolve_org,
)
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, resolve_project
from app.modules.identity.deps import Services
from app.modules.versions import repository


@dataclass(frozen=True, slots=True)
class VersionRef:
    project: ProjectAccess
    version_id: uuid.UUID


async def resolve_version(
    version_id: uuid.UUID, org: Annotated[OrgAccess, Depends(resolve_org)], services: Services
) -> VersionRef:
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, _):
        project_key = await repository.find_version_project_key(session, version_id)
    if project_key is None:
        raise not_found()
    return VersionRef(
        project=await resolve_project(project_key, org, services), version_id=version_id
    )


def require_version(permission: Permission) -> Any:
    async def check(ref: Annotated[VersionRef, Depends(resolve_version)]) -> VersionRef:
        if permission not in ref.project.permissions:
            raise forbidden()
        return ref

    setattr(check, AUTHZ_ATTRIBUTE, permission)
    return Depends(check)
