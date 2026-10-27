from collections.abc import Callable

import httpx
import pytest
from fastapi import FastAPI

from app.health import ReadinessChecks, ReadinessResponse
from tests.conftest import StaticReadiness


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
