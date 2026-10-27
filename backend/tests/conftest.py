from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from pydantic import SecretStr

from app.core.config import Settings
from app.health import ReadinessChecks, ReadinessResponse
from app.main import create_app

# Inert connection strings: unit tests never open connections.
UNIT_DATABASE_URL = "postgresql+asyncpg://app_rw:unit@127.0.0.1:1/unit"
UNIT_REDIS_URL = "redis://127.0.0.1:1/0"


@pytest.fixture(autouse=True)
def _isolate_settings_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Tests build Settings explicitly; ambient env (e.g. exported by make) must not leak in."""
    for field in Settings.model_fields:
        monkeypatch.delenv(field.upper(), raising=False)


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "environment": "test",
        "database_url": SecretStr(UNIT_DATABASE_URL),
        "redis_url": SecretStr(UNIT_REDIS_URL),
    }
    values.update(overrides)
    return Settings(**values)


class StaticReadiness:
    def __init__(self, response: ReadinessResponse) -> None:
        self.response = response

    async def check(self) -> ReadinessResponse:
        return self.response


READY = ReadinessResponse(status="ready", checks=ReadinessChecks(database="ok", redis="ok"))


@pytest.fixture
def app_factory() -> Callable[..., FastAPI]:
    def factory(**overrides: Any) -> FastAPI:
        readiness = overrides.pop("readiness", StaticReadiness(READY))
        return create_app(make_settings(**overrides), readiness=readiness, configure_logs=False)

    return factory


@pytest.fixture
def app(app_factory: Callable[..., FastAPI]) -> FastAPI:
    return app_factory()


@pytest.fixture
async def client(app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as http:
        yield http
