"""Sprint resolution for ``/sprints/{sprint_id}`` routes (M10). Same pattern as comments:
the sprint is looked up under RLS (a sprint of an invisible project is simply unknown, so
the same 404), then the caller's real permissions come from its project."""

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
from app.modules.sprints import repository


@dataclass(frozen=True, slots=True)
class SprintRef:
    project: ProjectAccess
    sprint_id: uuid.UUID


async def resolve_sprint(
    sprint_id: uuid.UUID, org: Annotated[OrgAccess, Depends(resolve_org)], services: Services
) -> SprintRef:
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, _):
        project_key = await repository.find_sprint_project_key(session, sprint_id)
    if project_key is None:
        raise not_found()
    return SprintRef(project=await resolve_project(project_key, org, services), sprint_id=sprint_id)


def require_sprint(permission: Permission) -> Any:
    async def check(ref: Annotated[SprintRef, Depends(resolve_sprint)]) -> SprintRef:
        if permission not in ref.project.permissions:
            raise forbidden()
        return ref

    setattr(check, AUTHZ_ATTRIBUTE, permission)
    return Depends(check)
