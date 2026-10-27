"""Readiness against real dependencies, including outage behavior (plan R5)."""

import os

import httpx
import pytest
from pydantic import SecretStr

from app.db.engine import create_db_engine
from app.db.role_check import UnsafeDatabaseRoleError
from app.health import DependencyReadinessProbe
from app.main import create_app, create_redis
from tests.conftest import make_settings

UNREACHABLE_DB = "postgresql+asyncpg://app_rw:x@127.0.0.1:1/none"
UNREACHABLE_REDIS = "redis://127.0.0.1:1/0"


async def _get_readyz(database_url: str, redis_url: str, **overrides: object) -> httpx.Response:
    settings = make_settings(
        database_url=SecretStr(database_url),
        redis_url=SecretStr(redis_url),
        readiness_timeout_seconds=1.5,
        redis_timeout_seconds=0.5,
        db_connect_timeout_seconds=1.0,
        **overrides,
    )
    app = create_app(settings, configure_logs=False)
    async with app.router.lifespan_context(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as http:
            return await http.get("/readyz")


@pytest.fixture
def urls() -> tuple[str, str]:
    return os.environ["TEST_DATABASE_URL"], os.environ["TEST_REDIS_URL"]


async def test_ready_when_dependencies_up(urls: tuple[str, str]) -> None:
    response = await _get_readyz(*urls)
    assert response.status_code == 200
    assert response.json() == {"status": "ready", "checks": {"database": "ok", "redis": "ok"}}


async def test_redis_outage_degrades_but_stays_in_rotation(urls: tuple[str, str]) -> None:
    response = await _get_readyz(urls[0], UNREACHABLE_REDIS)
    assert response.status_code == 200
    assert response.json()["checks"] == {"database": "ok", "redis": "degraded"}


async def test_database_outage_is_not_ready(urls: tuple[str, str]) -> None:
    response = await _get_readyz(UNREACHABLE_DB, urls[1])
    assert response.status_code == 503
    assert response.json()["checks"]["database"] == "unavailable"


async def test_unsafe_role_refuses_startup_in_production_like_env() -> None:
    owner_url = os.environ["TEST_MIGRATION_DATABASE_URL"]
    # Config validation would reject app_owner by name, so build settings for "test" and
    # flip enforcement the way staging/prod would, to exercise the runtime check itself.
    settings = make_settings(
        database_url=SecretStr(owner_url), redis_url=SecretStr(UNREACHABLE_REDIS)
    )
    settings.environment = "staging"
    app = create_app(settings, configure_logs=False)
    with pytest.raises(UnsafeDatabaseRoleError):
        async with app.router.lifespan_context(app):
            pass


async def test_unsafe_role_reports_misconfigured_when_check_was_deferred() -> None:
    """If the DB was down at startup, readiness performs the role check later."""
    owner_url = os.environ["TEST_MIGRATION_DATABASE_URL"]
    settings = make_settings(
        database_url=SecretStr(owner_url), redis_url=SecretStr(UNREACHABLE_REDIS)
    )
    engine = create_db_engine(settings)
    redis = create_redis(settings)
    probe = DependencyReadinessProbe(
        engine=engine, redis=redis, timeout_seconds=1.5, enforce_role_checks=True
    )
    try:
        result = await probe.check()
    finally:
        await redis.aclose()
        await engine.dispose()
    assert result.status == "unavailable"
    assert result.checks.database == "misconfigured"
