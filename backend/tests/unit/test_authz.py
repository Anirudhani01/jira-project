"""Authorization policy (plan §4.2, V3.6 D9 Option B) and slug rules (V2.6)."""

import pytest

from app.authz.permissions import (
    ORG_ROLE_PERMISSIONS,
    PROJECT_ROLE_ORG_PERMISSIONS,
    Permission,
    org_permissions,
    project_permissions,
)
from app.modules.orgs.slugs import RESERVED_SLUGS, is_reserved, is_well_formed_slug


@pytest.mark.parametrize(
    ("role", "grant", "project_roles", "allowed"),
    [
        ("owner", False, frozenset(), True),
        ("admin", False, frozenset(), True),
        ("member", False, frozenset(), False),
        ("member", True, frozenset(), True),
        # D9 Option B: project admin (on any number of projects) confers nothing org-wide.
        ("member", False, frozenset({"admin"}), False),
        ("member", False, frozenset({"admin", "member", "viewer"}), False),
    ],
)
def test_project_create_is_owner_admin_or_explicit_grant_only(
    role: str, grant: bool, project_roles: frozenset[str], allowed: bool
) -> None:
    granted = org_permissions(role, can_create_projects=grant, project_roles=project_roles)
    assert (Permission.PROJECT_CREATE in granted) is allowed


def test_project_roles_grant_no_org_permissions() -> None:
    assert all(not perms for perms in PROJECT_ROLE_ORG_PERMISSIONS.values())


def test_members_only_view_and_unknown_roles_get_nothing() -> None:
    assert ORG_ROLE_PERMISSIONS["member"] == {Permission.ORG_VIEW}
    assert org_permissions("viewer", can_create_projects=False) == frozenset()
    assert Permission.ORG_AUDIT_VIEW not in org_permissions("member", can_create_projects=True)


def test_reserved_slugs_are_exactly_the_revision_3_list() -> None:
    assert {
        "api", "admin", "app", "auth", "login", "logout", "signup", "o", "orgs", "new",
        "settings", "account", "invitations", "static", "assets", "health", "status",
        "support", "help", "docs", "www",
    } == RESERVED_SLUGS  # fmt: skip
    assert is_reserved("Admin")


@pytest.mark.parametrize(
    ("slug", "ok"),
    [("ab", True), ("a-b-1", True), ("ACME", True), ("a", False), ("-ab", False),
     ("a_b", False), ("a" * 39, True), ("a" * 40, False), ("é-acme", False)],
)  # fmt: skip
def test_slug_format(slug: str, ok: bool) -> None:
    assert is_well_formed_slug(slug) is ok


def test_issue_permissions_follow_project_roles() -> None:
    """M6/M7: viewers only read; members create/edit/assign/transition; admins (and org
    owners/admins) also delete. Org membership without a project role grants nothing."""
    issue = {Permission.ISSUE_CREATE, Permission.ISSUE_EDIT, Permission.ISSUE_DELETE}
    assign_transition = {Permission.ISSUE_ASSIGN, Permission.ISSUE_TRANSITION}
    assert project_permissions("member", "viewer") == {Permission.PROJECT_VIEW}
    member = project_permissions("member", "member")
    assert member & issue == {Permission.ISSUE_CREATE, Permission.ISSUE_EDIT}
    assert assign_transition <= member
    assert issue <= project_permissions("member", "admin")
    assert issue <= project_permissions("owner", None)
    assert issue <= project_permissions("admin", None)
    assert assign_transition <= project_permissions("member", "admin")
    assert assign_transition <= project_permissions("owner", None)
    assert project_permissions("member", None) == frozenset()


def test_comment_permissions_follow_the_same_buckets_as_issue_create_edit_delete() -> None:
    """M8: ``comment.create``/``comment.edit_own`` sit in the same role bucket as
    ``issue.create``/``issue.edit`` (viewer: neither; member/admin: both). There is no
    ``comment.edit_any``: only ``comment.delete_any`` sits in the admin-only bucket with
    ``issue.delete`` -- a project member can create/edit their own comments but can never
    delete someone else's."""
    create_edit = {Permission.COMMENT_CREATE, Permission.COMMENT_EDIT_OWN}
    delete_any = Permission.COMMENT_DELETE_ANY
    viewer = project_permissions("member", "viewer")
    assert not (create_edit & viewer)
    assert delete_any not in viewer
    member = project_permissions("member", "member")
    assert create_edit <= member
    assert delete_any not in member
    assert create_edit <= project_permissions("member", "admin")
    assert delete_any in project_permissions("member", "admin")
    assert create_edit <= project_permissions("owner", None)
    assert delete_any in project_permissions("owner", None)
    assert create_edit <= project_permissions("admin", None)
    assert delete_any in project_permissions("admin", None)
    assert project_permissions("member", None) & (create_edit | {delete_any}) == frozenset()
