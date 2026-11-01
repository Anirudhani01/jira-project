"""Migration round trip on an isolated database (``jira_migration``).

Destructive ``alembic downgrade`` runs never use ``jira_test``; see
``migration_support.ensure_roundtrip_database``. The session-scoped
``migrated_database`` fixture in ``conftest.py`` only runs ``upgrade head`` on
``TEST_MIGRATION_DATABASE_URL`` for the rest of the integration suite.
"""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.conftest import run_alembic
from tests.integration.migration_support import OBJECTS_0018, OBJECTS_0019, roundtrip_owner_url
from tests.integration.workflow_edit_privileges import (
    assert_0019_baseline,
    assert_0020_grants,
    assert_snapshots_equal,
    snapshot_workflow_graph_acl,
)

REVISION_COLUMN = text(
    """
    SELECT column_name, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workflows' AND column_name = 'revision'
    """
)
WORKFLOW_EDIT_POLICIES = text(
    """
    SELECT polname FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    WHERE c.relname IN ('workflows', 'workflow_statuses', 'workflow_transitions')
      AND pol.polname IN (
        'workflows_update',
        'workflow_statuses_update',
        'workflow_statuses_delete',
        'workflow_transitions_update',
        'workflow_transitions_delete'
      )
    ORDER BY 1
    """
)

HEAD = "0023"

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


async def test_0020_grants_roundtrip_restores_0019_privileges_exactly(
    migration_roundtrip_db: str,
    migration_owner_engine: AsyncEngine,
) -> None:
    """Explicit REVOKE in 0020 downgrade must restore M5 ACLs; INSERT grants must survive."""
    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    run_alembic("downgrade", "0019", migration_database_url=migration_roundtrip_db)
    baseline = await snapshot_workflow_graph_acl(migration_owner_engine)
    assert_0019_baseline(baseline)

    run_alembic("upgrade", "0020", migration_database_url=migration_roundtrip_db)
    at_head = await snapshot_workflow_graph_acl(migration_owner_engine)
    assert_0020_grants(at_head)

    run_alembic("downgrade", "0019", migration_database_url=migration_roundtrip_db)
    after_downgrade = await snapshot_workflow_graph_acl(migration_owner_engine)
    assert_snapshots_equal(baseline, after_downgrade)

    run_alembic("upgrade", "0020", migration_database_url=migration_roundtrip_db)
    reupgrade = await snapshot_workflow_graph_acl(migration_owner_engine)
    assert_0020_grants(reupgrade)


async def test_upgrade_head_and_0020_downgrade_leaves_0019_intact(
    migration_roundtrip_db: str,
    migration_owner_engine: AsyncEngine,
) -> None:
    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == HEAD
    policies = await _rows(migration_owner_engine, WORKFLOW_EDIT_POLICIES)
    assert len(policies) == 5
    [revision] = await _rows(migration_owner_engine, REVISION_COLUMN)
    assert revision[0] == "revision"
    assert revision[2] == "NO"

    run_alembic("downgrade", "0019", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == "0019"
    assert await _rows(migration_owner_engine, WORKFLOW_EDIT_POLICIES) == []
    assert await _rows(migration_owner_engine, REVISION_COLUMN) == []
    assert await _rows(migration_owner_engine, OBJECTS_0019) != []

    run_alembic("upgrade", "0020", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == "0020"
    assert len(await _rows(migration_owner_engine, WORKFLOW_EDIT_POLICIES)) == 5


async def test_upgrade_head_and_0019_downgrade_leaves_0018_intact(
    migration_roundtrip_db: str,
    migration_owner_engine: AsyncEngine,
) -> None:
    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == HEAD
    assert await _scalar(migration_owner_engine, PLATFORM_EVENTS) == 1
    assert await _rows(migration_owner_engine, OBJECTS_0019) != []

    run_alembic("downgrade", "0018", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == "0018"
    assert await _rows(migration_owner_engine, OBJECTS_0019) == []
    assert await _scalar(migration_owner_engine, PLATFORM_EVENTS) == 1
    assert await _rows(migration_owner_engine, OBJECTS_0018) != []

    run_alembic("upgrade", "0019", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == "0019"
    assert await _scalar(migration_owner_engine, PLATFORM_EVENTS) == 1

    run_alembic("upgrade", "head", migration_database_url=migration_roundtrip_db)
    assert await _scalar(migration_owner_engine, VERSION) == HEAD


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
    assert await _scalar(migration_owner_engine, VERSION) == "0018"
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
