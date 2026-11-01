"""Isolated database for destructive migration round-trip tests.

Integration tests may create ad hoc objects (for example probe tables in ``security``).
Those must not share the same database as ``alembic downgrade base``. This module
provisions ``jira_migration`` (or ``TEST_MIGRATION_ROUNDTRIP_DATABASE_URL``) via the
superuser URL and returns owner/superuser async URLs for tests.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from urllib.parse import unquote, urlparse, urlunparse

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

DEFAULT_ROUNDTRIP_DB = "jira_migration"

OBJECTS_0018 = text(
    """
    SELECT c.relkind::text AS kind, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind IN ('r', 'S', 'i', 'p')
      AND (
        (n.nspname = 'public' AND c.relname = 'org_authentication_events')
        OR (n.nspname = 'security' AND c.relname LIKE 'org_auth%')
      )
    UNION ALL
    SELECT 'f', p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE (n.nspname = 'security' AND p.proname IN (
            'apply_org_auth_projection',
            'record_org_auth_projection_failure',
            'reconcile_org_auth_projections',
            'detect_org_auth_missing_sources',
            'trg_org_auth_after_platform_insert',
            'operator_reset_org_auth_projection_failure'
          ))
       OR (n.nspname = 'public' AND p.proname = 'app_user_was_org_member_at')
    ORDER BY 2
    """
)

SECURITY_OBJECTS = text(
    """
    SELECT c.relkind::text AS kind, c.relname AS name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'security' AND c.relkind IN ('r', 'S', 'i', 'p', 'v')
    UNION ALL
    SELECT 'f', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'security'
    ORDER BY 2
    """
)


def _swap_db_name(url: str, db_name: str) -> str:
    parsed = urlparse(url)
    # postgresql+asyncpg://user:pass@host:port/db
    return urlunparse(parsed._replace(path=f"/{db_name}"))


def roundtrip_owner_url() -> str:
    explicit = os.environ.get("TEST_MIGRATION_ROUNDTRIP_DATABASE_URL")
    if explicit:
        return explicit
    base = os.environ["TEST_MIGRATION_DATABASE_URL"]
    return _swap_db_name(base, DEFAULT_ROUNDTRIP_DB)


def roundtrip_superuser_url() -> str:
    explicit = os.environ.get("TEST_MIGRATION_ROUNDTRIP_SUPERUSER_DATABASE_URL")
    if explicit:
        return explicit
    su = os.environ.get("TEST_SUPERUSER_DATABASE_URL")
    if not su:
        msg = "TEST_SUPERUSER_DATABASE_URL required to provision migration round-trip database"
        raise RuntimeError(msg)
    owner = roundtrip_owner_url()
    db_name = unquote(urlparse(owner).path.lstrip("/"))
    return _swap_db_name(su, db_name)


async def ensure_roundtrip_database() -> None:
    su_url = roundtrip_superuser_url()
    owner_url = roundtrip_owner_url()
    db_name = unquote(urlparse(owner_url).path.lstrip("/"))
    if not db_name.replace("_", "").isalnum():
        msg = f"invalid round-trip database name: {db_name!r}"
        raise ValueError(msg)
    admin = create_async_engine(su_url, pool_size=1, isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        exists = (
            await conn.execute(
                text("SELECT 1 FROM pg_database WHERE datname = :name"),
                {"name": db_name},
            )
        ).scalar_one_or_none()
        if not exists:
            await conn.execute(text(f'CREATE DATABASE "{db_name}" OWNER app_owner'))
        await conn.execute(
            text(f'GRANT CONNECT ON DATABASE "{db_name}" TO app_rw, app_worker, app_retention')
        )
    await admin.dispose()
    owner = create_async_engine(owner_url, pool_size=1)
    async with owner.begin() as conn:
        await conn.execute(
            text("GRANT USAGE ON SCHEMA public TO app_rw, app_worker, app_retention")
        )
    await owner.dispose()


@pytest.fixture(scope="module")
def migration_roundtrip_urls() -> tuple[str, str]:
    return roundtrip_owner_url(), roundtrip_superuser_url()


@pytest.fixture(scope="module")
def migration_roundtrip_db(migration_roundtrip_urls: tuple[str, str]) -> str:
    """Empty-ish database reserved for alembic round trips (not integration pollution)."""
    asyncio.run(ensure_roundtrip_database())
    owner_url, _ = migration_roundtrip_urls
    return owner_url


@pytest.fixture
async def migration_owner_engine(migration_roundtrip_db: str) -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(migration_roundtrip_db, pool_size=1, max_overflow=0)
    yield engine
    await engine.dispose()
