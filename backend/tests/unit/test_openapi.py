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


def test_openapi_has_only_authorized_routes() -> None:
    """Scope guard: routes beyond M2 must not appear before their milestone."""
    paths = set(json.loads(build_schema())["paths"])
    assert paths == M1_PATHS | M2_PATHS
