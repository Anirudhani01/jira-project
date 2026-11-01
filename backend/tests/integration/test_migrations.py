"""Migration round trip on an isolated database (``jira_migration``).

Destructive ``alembic downgrade`` runs never use ``jira_test``; see
``migration_support.ensure_roundtrip_database``. The session-scoped
``migrated_database`` fixture in ``conftest.py`` only runs ``upgrade head`` on
``TEST_MIGRATION_DATABASE_URL`` for the rest of the integration suite.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.conftest import run_alembic
from tests.integration.migration_support import OBJECTS_0018, roundtrip_owner_url

HEAD = "0018"

HELPERS = text(
    "SELECT count(*) FROM pg_proc WHERE proname IN ('app_current_org', 'app_current_user')"
)
CITEXT = text("SELECT count(*) FROM pg_extension WHERE extname = 'citext'")
VERSION = text("SELECT version_num FROM alembic_version")
IDENTITY_TABLES = text(
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE (n.nspname, c.relname) IN (('public', 'users'), ('public', 'user_sessions'), "
    "('security', 'platform_security_events'))"
)
SECURITY_SCHEMA = text("SELECT count(*) FROM pg_namespace WHERE nspname = 'security'")
PLATFORM_EVENTS = text(
    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'security' AND c.relname = 'platform_security_events'"
)


async def _scalar(engine: AsyncEngine, statement: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(statement)).scalar_one_or_none()  # type: ignore[call-overload]


async def _rows(engine: AsyncEngine, statement: object) -> list[tuple[object, ...]]:
    async with engine.connect() as conn:
        return list((await conn.execute(statement)).all())  # type: ignore[call-overload]


async def test_upgrade_head_and_0018_downgrade_leaves_pre0018_security_intact(
    migration_roundtrip_db: str,
    migration_owner_engine: AsyncEngine,
) -> None:
    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == HEAD
    assert await _scalar(migration_owner_engine, PLATFORM_EVENTS) == 1

    run_alembic("downgrade", "0017", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == "0017"
    assert await _rows(migration_owner_engine, OBJECTS_0018) == []
    assert await _scalar(migration_owner_engine, PLATFORM_EVENTS) == 1

    run_alembic("upgrade", "0018", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == HEAD
    assert await _scalar(migration_owner_engine, PLATFORM_EVENTS) == 1


async def test_full_round_trip_on_isolated_database(
    migration_roundtrip_db: str,
    migration_owner_engine: AsyncEngine,
) -> None:
    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == HEAD

    run_alembic("downgrade", "0001", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, IDENTITY_TABLES) == 0
    assert await _scalar(migration_owner_engine, SECURITY_SCHEMA) == 0
    assert await _scalar(migration_owner_engine, VERSION) == "0001"

    run_alembic("downgrade", "base", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, HELPERS) == 0
    assert await _scalar(migration_owner_engine, CITEXT) == 0
    assert await _scalar(migration_owner_engine, VERSION) is None

    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == HEAD
    assert await _scalar(migration_owner_engine, HELPERS) == 2
    assert await _scalar(migration_owner_engine, CITEXT) == 1
    assert await _scalar(migration_owner_engine, IDENTITY_TABLES) == 3
    assert await _scalar(migration_owner_engine, PLATFORM_EVENTS) == 1
    assert await _rows(migration_owner_engine, OBJECTS_0018) != []


def test_single_head_and_no_pending_model_changes(migration_roundtrip_db: str) -> None:
    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    heads = run_alembic("heads", migration_database_url=migration_roundtrip_db).stdout.split()
    assert heads[0] == HEAD
    assert heads.count("(head)") == 1
    run_alembic("check", migration_database_url=migration_roundtrip_db)


def test_roundtrip_database_is_not_shared_with_integration_db() -> None:
    assert roundtrip_owner_url() != __import__("os").environ["TEST_MIGRATION_DATABASE_URL"]
