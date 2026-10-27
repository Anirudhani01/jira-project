"""Alembic environment (async, asyncpg).

- Connects as the migration role from ``MIGRATION_DATABASE_URL`` (never the runtime role).
- Each revision runs in its own transaction (``transaction_per_migration``): a failing
  revision rolls back completely thanks to PostgreSQL transactional DDL.
- ``lock_timeout`` keeps a migration from stalling live traffic behind a lock queue.
"""

import asyncio
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# M0 has no ORM models; later milestones set this to the declarative Base metadata.
target_metadata = None

MIGRATION_LOCK_TIMEOUT = "5s"


def _migration_url() -> str:
    url = os.environ.get("MIGRATION_DATABASE_URL")
    if not url:
        raise RuntimeError("MIGRATION_DATABASE_URL is not set")
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_migration_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        transaction_per_migration=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def _run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        transaction_per_migration=True,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    engine = create_async_engine(
        _migration_url(),
        poolclass=pool.NullPool,
        connect_args={
            "server_settings": {
                "application_name": "jira-migrations",
                "lock_timeout": MIGRATION_LOCK_TIMEOUT,
            }
        },
    )
    try:
        async with engine.connect() as connection:
            await connection.run_sync(_run_migrations)
            await connection.commit()
    finally:
        await engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
