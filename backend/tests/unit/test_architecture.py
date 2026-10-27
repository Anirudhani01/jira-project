"""Architecture guards enforced as tests."""

import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
SET_CONFIG = re.compile(r"set_config\(\s*'app\.")
ALLOWED_SET_CONFIG = {BACKEND / "app" / "db" / "tenant.py"}


def _python_sources() -> list[Path]:
    roots = [BACKEND / "app", BACKEND / "migrations"]
    return [path for root in roots for path in root.rglob("*.py")]


def test_tenant_settings_are_only_bound_in_tenant_module() -> None:
    offenders = [
        str(path.relative_to(BACKEND))
        for path in _python_sources()
        if path not in ALLOWED_SET_CONFIG and SET_CONFIG.search(path.read_text(encoding="utf-8"))
    ]
    assert offenders == []


def test_m0_defines_no_orm_models() -> None:
    """M0 must not introduce domain tables; models arrive with later milestones."""
    offenders = [
        str(path.relative_to(BACKEND))
        for path in _python_sources()
        if re.search(r"DeclarativeBase|__tablename__|op\.create_table", path.read_text("utf-8"))
    ]
    assert offenders == []
