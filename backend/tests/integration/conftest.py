"""Integration fixtures: real PostgreSQL (migrated test database) and Redis.

Integration tests are skipped when TEST_* variables are absent, unless
REQUIRE_INTEGRATION=1 (set by `make test` and CI), in which case missing
configuration is an error so CI can never silently skip them.
"""

import os
import subprocess
import sys
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

BACKEND = Path(__file__).resolve().parents[2]
REQUIRED_ENV = ("TEST_DATABASE_URL", "TEST_MIGRATION_DATABASE_URL", "TEST_REDIS_URL")


def integration_env_missing() -> list[str]:
    return [name for name in REQUIRED_ENV if not os.environ.get(name)]


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    missing = integration_env_missing()
    integration_items = [item for item in items if "integration" in str(item.path)]
    for item in integration_items:
        item.add_marker(pytest.mark.integration)
    if not missing:
        return
    if os.environ.get("REQUIRE_INTEGRATION") == "1":
        raise pytest.UsageError(f"REQUIRE_INTEGRATION=1 but missing: {', '.join(missing)}")
    skip = pytest.mark.skip(reason=f"integration env not configured: {', '.join(missing)}")
    for item in integration_items:
        item.add_marker(skip)


def run_alembic(*args: str) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "MIGRATION_DATABASE_URL": os.environ["TEST_MIGRATION_DATABASE_URL"]}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )


@pytest.fixture(scope="session", autouse=True)
def migrated_database() -> None:
    if integration_env_missing():
        return
    run_alembic("upgrade", "head")


def _engine(url_env: str) -> AsyncEngine:
    return create_async_engine(os.environ[url_env], pool_size=1, max_overflow=0)


@pytest.fixture
async def rw_engine() -> AsyncIterator[AsyncEngine]:
    engine = _engine("TEST_DATABASE_URL")
    yield engine
    await engine.dispose()


@pytest.fixture
async def owner_engine() -> AsyncIterator[AsyncEngine]:
    engine = _engine("TEST_MIGRATION_DATABASE_URL")
    yield engine
    await engine.dispose()


@pytest.fixture
async def superuser_engine() -> AsyncIterator[AsyncEngine]:
    if not os.environ.get("TEST_SUPERUSER_DATABASE_URL"):
        pytest.skip("TEST_SUPERUSER_DATABASE_URL not configured")
    engine = _engine("TEST_SUPERUSER_DATABASE_URL")
    yield engine
    await engine.dispose()
