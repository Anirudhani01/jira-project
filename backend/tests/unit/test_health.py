import asyncio
import json
import logging
from collections.abc import Callable
from typing import cast
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.exc import OperationalError

from app.core.logging import JsonFormatter
from app.health import DependencyReadinessProbe, ReadinessChecks, ReadinessResponse
from tests.conftest import StaticReadiness

DB_PASSWORD = "unit-test-db-password-not-real"


def _wrapped_db_error() -> OperationalError:
    driver = asyncpg.exceptions.ConnectionDoesNotExistError("connection refused")
    return OperationalError(
        f"connection to postgresql+asyncpg://app_rw:{DB_PASSWORD}@db.example:5432/jira failed",
        {},
        driver,
    )


def _probe() -> DependencyReadinessProbe:
    return DependencyReadinessProbe(
        engine=MagicMock(),
        redis=AsyncMock(),
        timeout_seconds=1.0,
        enforce_role_checks=True,
    )


def _json_payload(record: logging.LogRecord) -> dict[str, object]:
    return cast(dict[str, object], json.loads(JsonFormatter().format(record)))


async def test_verify_role_at_startup_logs_readiness_deadline_timeout(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async def hang_forever(*_: object, **__: object) -> None:
        await asyncio.sleep(60)

    probe = _probe()
    probe._timeout = 0.05
    with (
        patch("app.health.verify_runtime_role", side_effect=hang_forever),
        caplog.at_level(logging.WARNING, logger="app.health"),
    ):
        await probe.verify_role_at_startup()

    record = next(r for r in caplog.records if "runtime role check deferred" in r.message)
    payload = _json_payload(record)
    assert payload["error_type"] == "builtins.TimeoutError"
    assert payload["timeout_scope"] == "readiness_deadline"
    assert payload["timeout_seconds"] == "0.05"
    error_message = payload["error_message"]
    assert isinstance(error_message, str)
    assert error_message


async def test_verify_role_at_startup_logs_sanitized_db_diagnostics(
    caplog: pytest.LogCaptureFixture,
) -> None:
    probe = _probe()
    with (
        patch("app.health.verify_runtime_role", side_effect=_wrapped_db_error()),
        caplog.at_level(logging.WARNING, logger="app.health"),
    ):
        await probe.verify_role_at_startup()

    record = next(r for r in caplog.records if "runtime role check deferred" in r.message)
    payload = _json_payload(record)
    assert payload["event"] == "db.role_check"
    assert payload["outcome"] == "deferred"
    assert payload["error_type"] == "sqlalchemy.exc.OperationalError"
    assert payload["driver_error_type"] == "asyncpg.exceptions.ConnectionDoesNotExistError"
    error_message = payload["error_message"]
    assert isinstance(error_message, str)
    assert "connection refused" in error_message
    assert DB_PASSWORD not in error_message
    assert DB_PASSWORD not in json.dumps(payload)


async def test_readiness_database_check_logs_sanitized_db_diagnostics(
    caplog: pytest.LogCaptureFixture,
) -> None:
    probe = _probe()
    probe._role_verified = True
    engine = MagicMock()
    connection = MagicMock()
    connection.__aenter__ = AsyncMock(return_value=connection)
    connection.__aexit__ = AsyncMock(return_value=None)
    connection.execute = AsyncMock(side_effect=_wrapped_db_error())
    engine.connect.return_value = connection
    probe._engine = engine

    with caplog.at_level(logging.WARNING, logger="app.health"):
        state = await probe._check_database()

    assert state == "unavailable"
    record = next(r for r in caplog.records if r.message == "readiness: database unavailable")
    payload = _json_payload(record)
    assert payload["check"] == "database"
    assert payload["error_type"] == "sqlalchemy.exc.OperationalError"
    assert payload["driver_error_type"] == "asyncpg.exceptions.ConnectionDoesNotExistError"
    assert DB_PASSWORD not in json.dumps(payload)


async def test_readiness_redis_check_logs_sanitized_diagnostics(
    caplog: pytest.LogCaptureFixture,
) -> None:
    redis_password = "unit-test-redis-password-not-real"
    probe = _probe()
    probe._timeout = 0.05
    redis = AsyncMock()
    redis.ping = AsyncMock(
        side_effect=TimeoutError(
            f"Error while reading from rediss://default:{redis_password}@cache.example:6379"
        )
    )
    probe._redis = redis

    with caplog.at_level(logging.WARNING, logger="app.health"):
        state = await probe._check_redis()

    assert state == "degraded"
    record = next(r for r in caplog.records if r.message == "readiness: redis degraded")
    payload = _json_payload(record)
    assert payload["check"] == "redis"
    assert payload["error_type"] == "builtins.TimeoutError"
    assert payload["timeout_scope"] == "readiness_deadline"
    assert payload["timeout_seconds"] == "0.05"
    error_message = payload["error_message"]
    assert isinstance(error_message, str)
    assert "Error while reading" in error_message
    assert redis_password not in error_message
    assert redis_password not in json.dumps(payload)


async def test_healthz_is_ok(client: httpx.AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    ("database", "redis", "expected_status", "expected_http"),
    [
        ("ok", "ok", "ready", 200),
        ("ok", "degraded", "degraded", 200),
        ("unavailable", "ok", "unavailable", 503),
        ("unavailable", "degraded", "unavailable", 503),
        ("misconfigured", "ok", "unavailable", 503),
    ],
)
async def test_readyz_maps_dependency_state(
    app_factory: Callable[..., FastAPI],
    database: str,
    redis: str,
    expected_status: str,
    expected_http: int,
) -> None:
    response_model = ReadinessResponse(
        status=expected_status,
        checks=ReadinessChecks(database=database, redis=redis),
    )
    application = app_factory(readiness=StaticReadiness(response_model))
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as http:
        response = await http.get("/readyz")
    assert response.status_code == expected_http
    assert response.json() == {
        "status": expected_status,
        "checks": {"database": database, "redis": redis},
    }
