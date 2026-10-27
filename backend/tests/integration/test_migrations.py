"""Migration round trip on the test database: head -> base -> head."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from tests.integration.conftest import run_alembic

HELPERS = text(
    "SELECT count(*) FROM pg_proc WHERE proname IN ('app_current_org', 'app_current_user')"
)
CITEXT = text("SELECT count(*) FROM pg_extension WHERE extname = 'citext'")
VERSION = text("SELECT version_num FROM alembic_version")


async def _scalar(engine: AsyncEngine, statement: object) -> object:
    async with engine.connect() as conn:
        return (await conn.execute(statement)).scalar_one_or_none()  # type: ignore[call-overload]


async def test_round_trip_upgrade_downgrade_upgrade(owner_engine: AsyncEngine) -> None:
    assert await _scalar(owner_engine, VERSION) == "0001"
    assert await _scalar(owner_engine, HELPERS) == 2

    run_alembic("downgrade", "base")
    assert await _scalar(owner_engine, HELPERS) == 0
    assert await _scalar(owner_engine, CITEXT) == 0
    assert await _scalar(owner_engine, VERSION) is None

    run_alembic("upgrade", "head")
    assert await _scalar(owner_engine, VERSION) == "0001"
    assert await _scalar(owner_engine, HELPERS) == 2
    assert await _scalar(owner_engine, CITEXT) == 1


async def test_single_head_and_no_pending_model_changes() -> None:
    heads = run_alembic("heads").stdout.split()
    assert heads[0] == "0001"
    assert heads.count("(head)") == 1
