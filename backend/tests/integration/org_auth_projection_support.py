"""Fixtures for A3.2 org auth projection integration tests (superuser setup only)."""

from __future__ import annotations

import os
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

EVENT_AT = datetime(2026, 6, 15, 12, 0, 0, tzinfo=UTC)
AUTH_EVENT_TYPE = "auth.login.succeeded"

# Rows inserted without a matching security.platform_security_events row must use ids above
# the live serial range so integration tests that INSERT real platform events never collide.
SYNTHETIC_PLATFORM_EVENT_ID_BASE = 900_000_000_000


def synthetic_platform_event_id(offset: int) -> int:
    return SYNTHETIC_PLATFORM_EVENT_ID_BASE + offset


def random_synthetic_platform_event_id() -> int:
    return synthetic_platform_event_id(uuid.uuid4().int % 1_000_000_000)


@dataclass
class OrgAuthFixture:
    user_id: uuid.UUID
    org_ids: list[uuid.UUID] = field(default_factory=list)
    platform_event_ids: list[int] = field(default_factory=list)
    extra_user_ids: list[uuid.UUID] = field(default_factory=list)

    def track_org(self, org_id: uuid.UUID) -> None:
        self.org_ids.append(org_id)

    def track_platform(self, platform_event_id: int) -> None:
        self.platform_event_ids.append(platform_event_id)


async def superuser_exec(statement: str, **params: Any) -> None:
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(statement), params)
    finally:
        await engine.dispose()


async def superuser_fetch(statement: str, **params: Any) -> list[Any]:
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(statement), params)
            return list(result.all()) if result.returns_rows else []
    finally:
        await engine.dispose()


async def owner_fetch(statement: str, **params: Any) -> list[Any]:
    engine = create_async_engine(os.environ["TEST_MIGRATION_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(statement), params)
            return list(result.all()) if result.returns_rows else []
    finally:
        await engine.dispose()


async def get_function_definition(procedure: str) -> str:
    allowed = (APPLY_DEF, RECORD_DEF, "security.reconcile_org_auth_projections(int)")
    if procedure not in allowed:
        raise ValueError("unexpected procedure name")
    rows = await superuser_fetch(
        f"SELECT pg_get_functiondef('{procedure}'::regprocedure) AS definition"
    )
    return str(rows[0].definition)


APPLY_DEF = "security.apply_org_auth_projection(bigint)"
RECORD_DEF = "security.record_org_auth_projection_failure(bigint,text,text)"


async def restore_function(definition: str) -> None:
    engine = create_async_engine(os.environ["TEST_MIGRATION_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(definition))
    finally:
        await engine.dispose()


async def create_user(*, display_name: str = "Projection User") -> uuid.UUID:
    user_id = uuid.uuid4()
    email = f"a32-proj-{user_id.hex[:14]}@example.com"
    await superuser_exec(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES (:u, :e, :name, 'x')",
        u=user_id,
        e=email,
        name=display_name,
    )
    return user_id


async def create_org(*, created_by: uuid.UUID, slug_prefix: str = "a32") -> uuid.UUID:
    org_id = uuid.uuid4()
    slug = f"{slug_prefix}-{uuid.uuid4().hex[:10]}"
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO organizations (id, slug, name, created_by) "
                    "VALUES (:o, :slug, 'A32 Org', :u)"
                ),
                {"o": org_id, "slug": slug, "u": created_by},
            )
            await conn.execute(
                text(
                    "INSERT INTO org_memberships (org_id, user_id, role, created_at) "
                    "VALUES (:o, :u, 'owner', :created)"
                ),
                {"o": org_id, "u": created_by, "created": EVENT_AT},
            )
    finally:
        await engine.dispose()
    return org_id


async def add_membership(
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    role: str = "member",
    created_at: datetime,
    removed_at: datetime | None = None,
) -> None:
    await superuser_exec(
        "INSERT INTO org_memberships (org_id, user_id, role, created_at, removed_at) "
        "VALUES (:o, :u, :r, :created, :removed)",
        o=org_id,
        u=user_id,
        r=role,
        created=created_at,
        removed=removed_at,
    )


async def insert_platform_auth_event(
    *,
    user_id: uuid.UUID,
    occurred_at: datetime = EVENT_AT,
    event_type: str = AUTH_EVENT_TYPE,
    outcome: str = "success",
    reason: str | None = "test_reason",
    metadata: str = '{"channel":"web"}',
) -> int:
    engine = create_async_engine(os.environ["TEST_SUPERUSER_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            platform_event_id = (
                await conn.execute(
                    text(
                        "INSERT INTO security.platform_security_events "
                        "(event_type, outcome, user_id, reason, metadata, occurred_at) "
                        "VALUES (:t, :out, :u, :reason, CAST(:md AS jsonb), :at) "
                        "RETURNING id"
                    ),
                    {
                        "t": event_type,
                        "out": outcome,
                        "u": user_id,
                        "reason": reason,
                        "md": metadata,
                        "at": occurred_at,
                    },
                )
            ).scalar_one()
    finally:
        await engine.dispose()
    return int(platform_event_id)


async def insert_platform_auth_event_rw(
    rw_engine: AsyncEngine,
    *,
    user_id: uuid.UUID,
    occurred_at: datetime = EVENT_AT,
    event_type: str = AUTH_EVENT_TYPE,
    outcome: str = "success",
) -> int:
    """Insert as ``app_rw`` without RETURNING (runtime roles have INSERT only)."""
    async with rw_engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO security.platform_security_events "
                "(event_type, outcome, user_id, occurred_at) "
                "VALUES (:t, :out, :u, :at)"
            ),
            {"t": event_type, "out": outcome, "u": user_id, "at": occurred_at},
        )
        platform_event_id = (
            await conn.execute(
                text(
                    "SELECT currval(pg_get_serial_sequence("
                    "'security.platform_security_events', 'id'))::bigint"
                )
            )
        ).scalar_one()
    return int(platform_event_id)


async def cleanup_fixture(fix: OrgAuthFixture) -> None:
    if fix.platform_event_ids:
        await superuser_exec(
            "DELETE FROM security.org_auth_projection_failures WHERE platform_event_id = ANY(:ids)",
            ids=fix.platform_event_ids,
        )
        await superuser_exec(
            "DELETE FROM security.org_auth_operator_actions WHERE platform_event_id = ANY(:ids)",
            ids=fix.platform_event_ids,
        )
        await superuser_exec(
            "DELETE FROM org_authentication_events WHERE platform_event_id = ANY(:ids)",
            ids=fix.platform_event_ids,
        )
        await superuser_exec(
            "DELETE FROM security.platform_security_events WHERE id = ANY(:ids)",
            ids=fix.platform_event_ids,
        )
    for org_id in fix.org_ids:
        await superuser_exec("DELETE FROM org_memberships WHERE org_id = :o", o=org_id)
        await superuser_exec("DELETE FROM organizations WHERE id = :o", o=org_id)
    for uid in [fix.user_id, *fix.extra_user_ids]:
        await superuser_exec("DELETE FROM users WHERE id = :u", u=uid)


async def replace_apply_with_forced_failure() -> None:
    engine = create_async_engine(os.environ["TEST_MIGRATION_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    CREATE OR REPLACE FUNCTION security.apply_org_auth_projection(p_event_id bigint)
                    RETURNS void
                    LANGUAGE plpgsql
                    SECURITY DEFINER
                    SET search_path = public, security, pg_temp
                    AS $$
                    BEGIN
                      RAISE EXCEPTION 'test forced apply failure' USING ERRCODE = 'P0001';
                    END;
                    $$
                    """
                )
            )
    finally:
        await engine.dispose()


async def replace_record_failure_with_forced_failure() -> None:
    engine = create_async_engine(os.environ["TEST_MIGRATION_DATABASE_URL"], pool_size=1)
    try:
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    """
                    CREATE OR REPLACE FUNCTION security.record_org_auth_projection_failure(
                      p_platform_event_id bigint,
                      p_sqlstate text,
                      p_message text
                    )
                    RETURNS void
                    LANGUAGE plpgsql
                    SECURITY DEFINER
                    SET search_path = public, security, pg_temp
                    AS $$
                    BEGIN
                      RAISE EXCEPTION 'test forced record failure' USING ERRCODE = 'P0001';
                    END;
                    $$
                    """
                )
            )
    finally:
        await engine.dispose()
