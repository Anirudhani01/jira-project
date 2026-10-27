"""M2 least-privilege grants (plan R3.1): the API role may only INSERT into the outbox
and only read/consume tokens; only the worker role mints tokens and drives the outbox;
the worker has no access to sessions and cannot write users."""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.role_check import verify_runtime_role

DENIED = [
    ("rw", "SELECT id FROM outbox"),
    ("rw", "UPDATE outbox SET attempts = 0"),
    ("rw", "DELETE FROM outbox"),
    (
        "rw",
        "INSERT INTO user_tokens (user_id, purpose, token_hash, expires_at) "
        "VALUES (gen_random_uuid(), 'verify_email', '\\x00', now())",
    ),
    ("rw", "DELETE FROM user_tokens"),
    ("worker", "SELECT id FROM user_sessions"),
    ("worker", "UPDATE user_sessions SET revoked_at = now()"),
    (
        "worker",
        "INSERT INTO users (email, display_name, password_hash) VALUES ('a@b.cd', 'x', 'x')",
    ),
    ("worker", "UPDATE users SET display_name = 'x'"),
    ("worker", "INSERT INTO outbox (topic) VALUES ('email.verify')"),
    ("worker", "DELETE FROM outbox"),
    ("worker", "DELETE FROM user_tokens"),
    ("worker", "TRUNCATE outbox"),
]


@pytest.mark.parametrize(("role", "statement"), DENIED)
async def test_runtime_roles_are_denied(
    rw_engine: AsyncEngine, worker_engine: AsyncEngine, role: str, statement: str
) -> None:
    engine = rw_engine if role == "rw" else worker_engine
    async with engine.connect() as conn:
        with pytest.raises(DBAPIError, match="permission denied"):
            await conn.execute(text(statement))


async def test_api_role_can_enqueue_and_consume_tokens(rw_engine: AsyncEngine) -> None:
    async with rw_engine.begin() as conn:
        await conn.execute(
            text("INSERT INTO outbox (topic, payload) VALUES ('email.verify', :p)"),
            {"p": f'{{"user_id": "{uuid.uuid4()}"}}'},
        )
        await conn.execute(
            text("UPDATE user_tokens SET used_at = now() WHERE token_hash = '\\x00'")
        )
        await conn.rollback()


async def test_worker_role_can_drive_outbox_and_read_tokens(worker_engine: AsyncEngine) -> None:
    async with worker_engine.begin() as conn:
        await conn.execute(text("SELECT id FROM outbox LIMIT 1"))
        await conn.execute(text("UPDATE outbox SET attempts = attempts WHERE false"))
        await conn.execute(text("SELECT id FROM user_tokens LIMIT 1"))
        # users is readable only through RLS: without a bound user, nothing is visible.
        rows = (await conn.execute(text("SELECT id FROM users"))).all()
        assert rows == []
        await conn.rollback()


async def test_worker_role_passes_the_runtime_role_check(worker_engine: AsyncEngine) -> None:
    assert await verify_runtime_role(worker_engine, enforce=True) == []
