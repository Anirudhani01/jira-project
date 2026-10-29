"""Migration round trip on the test database: head -> base -> head."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.conftest import run_alembic

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
HEAD = "0011"


async def _scalar(engine: AsyncEngine, statement: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(statement)).scalar_one_or_none()  # type: ignore[call-overload]


async def test_round_trip_upgrade_downgrade_upgrade(owner_engine: AsyncEngine) -> None:
    assert await _scalar(owner_engine, VERSION) == HEAD
    assert await _scalar(owner_engine, HELPERS) == 2
    assert await _scalar(owner_engine, IDENTITY_TABLES) == 3

    run_alembic("downgrade", "0001")
    assert await _scalar(owner_engine, IDENTITY_TABLES) == 0
    assert await _scalar(owner_engine, SECURITY_SCHEMA) == 0
    assert await _scalar(owner_engine, VERSION) == "0001"

    run_alembic("downgrade", "base")
    assert await _scalar(owner_engine, HELPERS) == 0
    assert await _scalar(owner_engine, CITEXT) == 0
    assert await _scalar(owner_engine, VERSION) is None

    run_alembic("upgrade", "head")
    assert await _scalar(owner_engine, VERSION) == HEAD
    assert await _scalar(owner_engine, HELPERS) == 2
    assert await _scalar(owner_engine, CITEXT) == 1
    assert await _scalar(owner_engine, IDENTITY_TABLES) == 3


async def test_single_head_and_no_pending_model_changes() -> None:
    heads = run_alembic("heads").stdout.split()
    assert heads[0] == HEAD
    assert heads.count("(head)") == 1
    # Fails if ORM models and migrations disagree (autogenerate would emit operations).
    run_alembic("check")
