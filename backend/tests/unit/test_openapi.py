import json
from pathlib import Path

from app.scripts.export_openapi import DEFAULT_OUTPUT, build_schema


def test_committed_openapi_matches_application() -> None:
    """Fails when the API changes without regenerating openapi.json (`make openapi`)."""
    assert DEFAULT_OUTPUT.exists(), "run `make openapi` to generate backend/openapi.json"
    committed = Path(DEFAULT_OUTPUT).read_text(encoding="utf-8")
    assert committed == build_schema(), "openapi.json is stale; run `make openapi`"


M1_PATHS = {
    "/healthz",
    "/readyz",
    "/api/v1/auth/signup",
    "/api/v1/auth/login",
    "/api/v1/auth/logout",
    "/api/v1/auth/session",
    "/api/v1/me",
    "/api/v1/me/password",
    "/api/v1/me/sessions",
    "/api/v1/me/sessions/{session_id}",
    "/api/v1/me/sessions/revoke-others",
}
M2_PATHS = {
    "/api/v1/auth/verify-email",
    "/api/v1/auth/password-reset/request",
    "/api/v1/auth/password-reset/confirm",
}
M3_PATHS = {
    "/api/v1/orgs",
    "/api/v1/orgs/{org_slug}",
    "/api/v1/orgs/{org_slug}/issue-types",
    "/api/v1/orgs/{org_slug}/priorities",
    "/api/v1/orgs/{org_slug}/audit-events",
}
M4_PATHS = {
    "/api/v1/orgs/{org_slug}/members",
    "/api/v1/orgs/{org_slug}/members/{user_id}",
    "/api/v1/orgs/{org_slug}/invitations",
    "/api/v1/orgs/{org_slug}/invitations/{invitation_id}",
    "/api/v1/invitations/accept",
}
M5_PATHS = {
    "/api/v1/orgs/{org_slug}/projects",
    "/api/v1/orgs/{org_slug}/projects/{project_key}",
    "/api/v1/orgs/{org_slug}/projects/{project_key}/archive",
    "/api/v1/orgs/{org_slug}/projects/{project_key}/unarchive",
    "/api/v1/orgs/{org_slug}/projects/{project_key}/workflow",
    "/api/v1/orgs/{org_slug}/projects/{project_key}/members",
    "/api/v1/orgs/{org_slug}/projects/{project_key}/members/{user_id}",
}
M6_PATHS = {
    "/api/v1/orgs/{org_slug}/projects/{project_key}/issues",
    "/api/v1/orgs/{org_slug}/issues",
    "/api/v1/orgs/{org_slug}/issues/{issue_key}",
    "/api/v1/orgs/{org_slug}/issues/{issue_key}/activity",
}
M7_PATHS = {
    "/api/v1/orgs/{org_slug}/issues/{issue_key}/children",
    "/api/v1/orgs/{org_slug}/issues/{issue_key}/transitions",
    "/api/v1/orgs/{org_slug}/projects/{project_key}/labels",
    "/api/v1/orgs/{org_slug}/projects/{project_key}/labels/{label_id}",
}
M8_PATHS = {
    "/api/v1/orgs/{org_slug}/issues/{issue_key}/comments",
    "/api/v1/orgs/{org_slug}/comments/{comment_id}",
}


def test_openapi_has_only_authorized_routes() -> None:
    """Scope guard: routes beyond M8 must not appear before their milestone."""
    paths = set(json.loads(build_schema())["paths"])
    assert paths == (
        M1_PATHS | M2_PATHS | M3_PATHS | M4_PATHS | M5_PATHS | M6_PATHS | M7_PATHS | M8_PATHS
    )
