"""Comment resolution for the ``PATCH``/``DELETE /comments/{id}`` routes (M8, plan
§3.2/§4.2/§4.3).

Unlike issues, these two routes are not nested under an issue key in the URL (the plan's
own endpoint table: ``PATCH/DELETE /orgs/{org}/comments/{id}``), so the comment has to be
looked up first to find which project it belongs to. Visibility falls out of that lookup
for free: ``find_comment_issue_ref`` runs under ``comments_select`` RLS, which follows its
issue's own visibility policy, so a comment in a project the caller cannot view is already
invisible -- it resolves to the same 404 as an unknown comment id, without any separate
check here. ``resolve_project`` is then called exactly as ``resolve_issue`` already calls
it, to get the caller's actual permissions for the comment's project.

The exact action-level rule (edit is author-only; delete is author-or-admin, and an
author's own-delete additionally requires they still hold a non-viewer project role) is
*not* encoded in a single fixed-permission check here -- it depends on comparing the
caller to the comment's author, which this module has no opinion on. Routes depend on
``require_comment(Permission.PROJECT_VIEW)`` only (so a non-member never reaches the
service layer at all); the service layer makes the actual author-vs-permission decision
and raises its own 403, the same way M7 resolved the ``issue.assign`` compound rule.
"""

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
from app.modules.comments import repository
from app.modules.identity.deps import Services


@dataclass(frozen=True, slots=True)
class CommentRef:
    project: ProjectAccess
    comment_id: uuid.UUID
    seq: int
    author_id: uuid.UUID

    @property
    def issue_key(self) -> str:
        return f"{self.project.key}-{self.seq}"


async def resolve_comment(
    comment_id: uuid.UUID, org: Annotated[OrgAccess, Depends(resolve_org)], services: Services
) -> CommentRef:
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, _):
        found = await repository.find_comment_issue_ref(session, comment_id)
    if found is None:
        raise not_found()
    project = await resolve_project(found.project_key, org, services)
    return CommentRef(
        project=project, comment_id=found.id, seq=found.seq, author_id=found.author_id
    )


def require_comment(permission: Permission) -> Any:
    async def check(ref: Annotated[CommentRef, Depends(resolve_comment)]) -> CommentRef:
        if permission not in ref.project.permissions:
            raise forbidden()
        return ref

    setattr(check, AUTHZ_ATTRIBUTE, permission)
    return Depends(check)
