"""Two-tenant harness for M3 tests (plan R3.5).

Tenants are created through the real API (signup, verification, login, POST /orgs). Every
isolation assertion runs as the restricted runtime roles (``app_rw`` / ``app_worker``)
with a bound context; the superuser connection is used only to set fixtures up and to
inspect state, never to prove a denial.
"""

import os
import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine

from app.db.tenant import TenantContext, bind_tenant
from tests.integration.auth_support import (
    auth_client,
    csrf,
    login,
    signup,
    superuser_sql,
    unique_email,
)

# Tables holding tenant data in M3 (``organizations`` is the tenant root, keyed by id).
TENANT_TABLES = (
    "org_memberships",
    "issue_types",
    "priorities",
    "audit_events",
    "outbox",
    "issues",
    "issue_activity",
    "idempotency_keys",
    "labels",
    "issue_labels",
    "comments",
)


@dataclass
class Tenant:
    email: str
    user_id: uuid.UUID
    org_id: uuid.UUID
    slug: str
    http: httpx.AsyncClient

    async def headers(self) -> dict[str, str]:
        return {"X-CSRF-Token": await csrf(self.http)}


def unique_slug(prefix: str = "org") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


async def verified_user(http: httpx.AsyncClient) -> tuple[str, uuid.UUID]:
    email = unique_email()
    assert (await signup(http, email)).status_code == 202
    await superuser_sql("UPDATE users SET email_verified_at = now() WHERE email = :e", e=email)
    assert (await login(http, email)).status_code == 204
    [row] = await superuser_sql("SELECT id FROM users WHERE email = :e", e=email)
    return email, row.id


async def create_org(http: httpx.AsyncClient, slug: str, name: str = "Acme") -> httpx.Response:
    return await http.post(
        "/api/v1/orgs",
        json={"slug": slug, "name": name},
        headers={"X-CSRF-Token": await csrf(http)},
    )


async def make_tenant(stack: AsyncExitStack, prefix: str = "org") -> Tenant:
    http = await stack.enter_async_context(auth_client())
    email, user_id = await verified_user(http)
    slug = unique_slug(prefix)
    response = await create_org(http, slug)
    assert response.status_code == 201, response.text
    [org] = await superuser_sql("SELECT id FROM organizations WHERE slug = :s", s=slug)
    return Tenant(email=email, user_id=user_id, org_id=org.id, slug=slug, http=http)


async def add_member(org_id: uuid.UUID, user_id: uuid.UUID, role: str = "member") -> None:
    """Fixture setup only (memberships are managed through the API from M4)."""
    await superuser_sql(
        "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:o, :u, :r)",
        o=org_id,
        u=user_id,
        r=role,
    )


async def add_backup_owner(org_id: uuid.UUID) -> uuid.UUID:
    """Fixture setup: a second owner, so tests can demote/remove the first one without
    tripping the last-owner invariant (M4 ``org_keeps_owner`` trigger)."""
    user_id = uuid.uuid4()
    await superuser_sql(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES (:u, :e, 'Backup', 'x')",
        u=user_id,
        e=f"backup-{user_id.hex[:12]}@example.com",
    )
    await add_member(org_id, user_id, "owner")
    return user_id


@asynccontextmanager
async def bound(
    engine: AsyncEngine, *, org_id: uuid.UUID | None, user_id: uuid.UUID | None
) -> AsyncIterator[AsyncSession]:
    """A transaction as the engine's (restricted) role with the given context; rolled back."""
    async with AsyncSession(bind=engine) as session:
        await session.begin()
        if org_id is not None or user_id is not None:
            await bind_tenant(session, TenantContext(org_id=org_id, user_id=user_id))
        try:
            yield session
        finally:
            await session.rollback()


async def rows(
    engine: AsyncEngine,
    sql: str,
    *,
    org_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    **params: Any,
) -> list[Any]:
    async with bound(engine, org_id=org_id, user_id=user_id) as session:
        result = await session.execute(text(sql), params)
        return list(result.all())


async def affected(
    engine: AsyncEngine,
    sql: str,
    *,
    org_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    **params: Any,
) -> int:
    async with bound(engine, org_id=org_id, user_id=user_id) as session:
        result = await session.execute(text(sql), params)
        return int(result.rowcount)  # type: ignore[attr-defined]


async def denied(
    engine: AsyncEngine,
    sql: str,
    *,
    org_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
    commit: bool = False,
    **params: Any,
) -> str:
    """Run a statement expected to fail; return the database error message."""
    try:
        async with AsyncSession(bind=engine) as session, session.begin():
            if org_id is not None or user_id is not None:
                await bind_tenant(session, TenantContext(org_id=org_id, user_id=user_id))
            await session.execute(text(sql), params)
            if not commit:
                raise AssertionError(f"statement unexpectedly succeeded: {sql}")
    except DBAPIError as exc:
        return str(exc.orig)
    raise AssertionError(f"commit unexpectedly succeeded: {sql}")


async def checksum() -> str:
    """Fingerprint of all M3 tenant data (superuser inspection only)."""
    [row] = await superuser_sql(
        "SELECT md5(string_agg(t, '|' ORDER BY t)) AS digest FROM ("
        " SELECT 'o' || o::text AS t FROM organizations o"
        " UNION ALL SELECT 'm' || m::text FROM org_memberships m"
        " UNION ALL SELECT 'i' || i::text FROM issue_types i"
        " UNION ALL SELECT 'p' || p::text FROM priorities p"
        " UNION ALL SELECT 'a' || a::text FROM audit_events a) s"
    )
    return str(row.digest)


def restricted_engine(url_env: str) -> AsyncEngine:
    return create_async_engine(os.environ[url_env], pool_size=1, max_overflow=0)
