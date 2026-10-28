"""Permissions and the role -> permission policy (plan §4.2, V3.6). The only place
roles appear. M3 defines org-level permissions plus ``project.create`` (D9 Option B);
project roles and their permissions arrive with projects in M5."""

from enum import StrEnum
from typing import Final


class Permission(StrEnum):
    ORG_VIEW = "org.view"
    ORG_MANAGE = "org.manage"
    ORG_MEMBERS_MANAGE = "org.members.manage"
    ORG_AUDIT_VIEW = "org.audit.view"
    PROJECT_CREATE = "project.create"
    # Project-scoped (M5)
    PROJECT_VIEW = "project.view"
    PROJECT_MANAGE = "project.manage"
    PROJECT_MEMBERS_MANAGE = "project.members.manage"
    # Issue-scoped (M6); issue.assign / issue.transition arrive in M7
    ISSUE_CREATE = "issue.create"
    ISSUE_EDIT = "issue.edit"
    ISSUE_DELETE = "issue.delete"


_ADMIN: Final = frozenset(
    {
        Permission.ORG_VIEW,
        Permission.ORG_MANAGE,
        Permission.ORG_MEMBERS_MANAGE,
        Permission.ORG_AUDIT_VIEW,
        Permission.PROJECT_CREATE,
    }
)
ORG_ROLE_PERMISSIONS: Final[dict[str, frozenset[Permission]]] = {
    "owner": _ADMIN,
    "admin": _ADMIN,
    "member": frozenset({Permission.ORG_VIEW}),
}
# Project roles (M5) never confer project.create: holding project admin on any project
# grants no org-wide right (D9 Option B). Declared here so the rule is testable now.
PROJECT_ROLE_ORG_PERMISSIONS: Final[dict[str, frozenset[Permission]]] = {
    "admin": frozenset(),
    "member": frozenset(),
    "viewer": frozenset(),
}


def org_permissions(
    role: str, *, can_create_projects: bool, project_roles: frozenset[str] = frozenset()
) -> frozenset[Permission]:
    """Effective org-level permissions of an active member."""
    granted = set(ORG_ROLE_PERMISSIONS.get(role, frozenset()))
    for project_role in project_roles:
        granted |= PROJECT_ROLE_ORG_PERMISSIONS.get(project_role, frozenset())
    if can_create_projects:  # explicit, owner/admin-set grant (audited; endpoint in M4)
        granted.add(Permission.PROJECT_CREATE)
    return frozenset(granted)


_PROJECT_ALL: Final = frozenset(
    {
        Permission.PROJECT_VIEW,
        Permission.PROJECT_MANAGE,
        Permission.PROJECT_MEMBERS_MANAGE,
        Permission.ISSUE_CREATE,
        Permission.ISSUE_EDIT,
        Permission.ISSUE_DELETE,
    }
)
PROJECT_ROLE_PERMISSIONS: Final[dict[str, frozenset[Permission]]] = {
    "admin": _PROJECT_ALL,
    "member": frozenset({Permission.PROJECT_VIEW, Permission.ISSUE_CREATE, Permission.ISSUE_EDIT}),
    "viewer": frozenset({Permission.PROJECT_VIEW}),
}


def project_permissions(org_role: str, project_role: str | None) -> frozenset[Permission]:
    """Org owners/admins are implicit project admins on every project of their org (§1.1);
    everyone else needs a project role. No project role confers org-wide rights (D9)."""
    if org_role in ("owner", "admin"):
        return _PROJECT_ALL
    return PROJECT_ROLE_PERMISSIONS.get(project_role or "", frozenset())
