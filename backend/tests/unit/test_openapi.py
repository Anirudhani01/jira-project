import json
from pathlib import Path

from app.scripts.export_openapi import DEFAULT_OUTPUT, build_schema


def test_committed_openapi_matches_application() -> None:
    """Fails when the API changes without regenerating openapi.json (`make openapi`)."""
    assert DEFAULT_OUTPUT.exists(), "run `make openapi` to generate backend/openapi.json"
    committed = Path(DEFAULT_OUTPUT).read_text(encoding="utf-8")
    assert committed == build_schema(), "openapi.json is stale; run `make openapi`"


def test_openapi_has_only_m0_routes() -> None:
    paths = set(json.loads(build_schema())["paths"])
    assert paths == {"/healthz", "/readyz"}
