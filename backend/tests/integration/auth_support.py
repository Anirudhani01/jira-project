"""Helpers for identity integration tests (real PostgreSQL and Redis)."""

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI
from pydantic import SecretStr
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.main import create_app
from tests.conftest import make_settings

ORIGIN = "https://app.test"
STRONG_PASSWORD = "Velvet-Harbor-Lantern-93"  # gitleaks:allow (synthetic test password)
OTHER_PASSWORD = "Copper-Meadow-Falcon-58"


def unique_email() -> str:
    return f"user-{uuid.uuid4().hex[:12]}@example.com"


def integration_settings(**overrides: Any) -> Any:
    values: dict[str, Any] = {
        "database_url": SecretStr(os.environ["TEST_DATABASE_URL"]),
        "redis_url": SecretStr(os.environ["TEST_REDIS_URL"]),
        "app_base_url": ORIGIN,
        "redis_timeout_seconds": 0.5,
        # Delivery to the local Mailpit sink (free; nothing leaves the machine).
        "email_delivery_enabled": True,
        "email_from": "no-reply@jira.test",
        "smtp_host": os.environ["TEST_SMTP_HOST"],
        "smtp_port": int(os.environ["TEST_SMTP_PORT"]),
        "smtp_security": "none",
        "smtp_timeout_seconds": 5,
    }
    values.update(overrides)
    return make_settings(**values)


async def flush_test_redis() -> None:
    redis = Redis.from_url(os.environ["TEST_REDIS_URL"])
    try:
        await redis.flushdb()
    finally:
        await redis.aclose()


@asynccontextmanager
async def running_app(app: FastAPI) -> AsyncIterator[FastAPI]:
    async with app.router.lifespan_context(app):
        yield app


def client_for(app: FastAPI) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    return httpx.AsyncClient(transport=transport, base_url=ORIGIN, headers={"Origin": ORIGIN})


@asynccontextmanager
async def auth_client(**overrides: Any) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(integration_settings(**overrides), configure_logs=False)
    async with running_app(app), client_for(app) as http:
        yield http


async def signup(
    http: httpx.AsyncClient, email: str, password: str = STRONG_PASSWORD
) -> httpx.Response:
    return await http.post(
        "/api/v1/auth/signup",
        json={"email": email, "password": password, "display_name": "Test User"},
    )


async def login(
    http: httpx.AsyncClient, email: str, password: str = STRONG_PASSWORD
) -> httpx.Response:
    return await http.post("/api/v1/auth/login", json={"email": email, "password": password})


async def csrf(http: httpx.AsyncClient) -> str:
    response = await http.get("/api/v1/auth/session")
    response.raise_for_status()
    token: str = response.json()["csrf_token"]
    return token


async def superuser_sql(statement: str, **params: Any) -> list[Any]:
    """Inspection/time-travel as the superuser (tests only; bypasses RLS)."""
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(statement), params)
            return list(result.all()) if result.returns_rows else []
    finally:
        await engine.dispose()
