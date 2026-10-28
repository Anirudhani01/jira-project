"""Issue-key resolution for issue routes (M6, plan §4.2/§4.3).

``{issue_key}`` (``KEY-n``) is resolved through its project, using the same visibility
rule as project routes: a caller who cannot view the project gets the same 404 as for an
unknown project or issue, whatever the key. Organization membership alone grants nothing.
The issue row itself is loaded (and the access re-checked) inside the handler's
transaction (``project_transaction``).
"""

import re
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends

from app.authz.deps import AUTHZ_ATTRIBUTE, OrgAccess, forbidden, not_found, resolve_org
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, resolve_project
from app.modules.identity.deps import Services

ISSUE_KEY = re.compile(r"([A-Za-z][A-Za-z0-9]{1,9})-([1-9][0-9]{0,8})")


@dataclass(frozen=True, slots=True)
class IssueRef:
    project: ProjectAccess
    seq: int

    @property
    def key(self) -> str:
        return f"{self.project.key}-{self.seq}"


async def resolve_issue(
    issue_key: str, org: Annotated[OrgAccess, Depends(resolve_org)], services: Services
) -> IssueRef:
    match = ISSUE_KEY.fullmatch(issue_key)
    if match is None:
        raise not_found()
    project = await resolve_project(match.group(1).upper(), org, services)
    return IssueRef(project=project, seq=int(match.group(2)))


def require_issue(permission: Permission) -> Any:
    async def check(ref: Annotated[IssueRef, Depends(resolve_issue)]) -> IssueRef:
        if permission not in ref.project.permissions:
            raise forbidden()
        return ref

    setattr(check, AUTHZ_ATTRIBUTE, permission)
    return Depends(check)
