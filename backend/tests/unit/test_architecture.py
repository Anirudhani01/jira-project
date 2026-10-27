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


# Tables each milestone may introduce. A table outside this list means scope creep or a
# later milestone's work; update deliberately when a milestone is authorized.
ALLOWED_TABLES = frozenset({"users", "user_sessions", "platform_security_events"})


def test_only_authorized_milestone_tables_exist() -> None:
    from app.db.base import Base, import_all_models  # noqa: PLC0415

    import_all_models()
    assert {table.name for table in Base.metadata.sorted_tables} == ALLOWED_TABLES
    created = set()
    for path in (BACKEND / "migrations" / "versions").glob("*.py"):
        created |= set(re.findall(r'op\.create_table\(\s*"([a-z_]+)"', path.read_text("utf-8")))
    assert created == ALLOWED_TABLES


IDENTITY_PACKAGE = BACKEND / "app" / "modules" / "identity"
IDENTITY_TABLE_USERS = {BACKEND / "app" / "db" / "base.py", BACKEND / "app" / "cli.py"}


def test_identity_tables_are_only_touched_by_identity_module() -> None:
    """Plan R3.4: sessions/users are accessed only through the identity module."""
    offenders = [
        str(path.relative_to(BACKEND))
        for path in (BACKEND / "app").rglob("*.py")
        if IDENTITY_PACKAGE not in path.parents
        and path not in IDENTITY_TABLE_USERS
        and re.search(
            r"identity\.(models|repository)\b|import (User|UserSession)\b", path.read_text("utf-8")
        )
    ]
    assert offenders == []
