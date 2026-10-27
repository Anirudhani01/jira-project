"""Async SQLAlchemy engine configuration."""

from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.config import Settings


def create_db_engine(
    settings: Settings, *, application_name: str = "jira-api", url: SecretStr | None = None
) -> AsyncEngine:
    """Create the runtime engine (``url`` defaults to DATABASE_URL; the worker passes its own).

    Connections are lazy, so creating the engine never touches the network. Server-side
    timeouts bound every statement, lock wait and idle transaction.
    """
    return create_async_engine(
        (url or settings.database_url).get_secret_value(),
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout_seconds,
        pool_pre_ping=True,
        # Never embed bound parameters (password hashes, token hashes, emails) in exception
        # messages: those reach logs via tracebacks.
        hide_parameters=True,
        connect_args={
            "timeout": settings.db_connect_timeout_seconds,
            "server_settings": {
                "application_name": application_name,
                "statement_timeout": str(settings.db_statement_timeout_ms),
                "lock_timeout": str(settings.db_lock_timeout_ms),
                "idle_in_transaction_session_timeout": str(
                    settings.db_idle_in_transaction_timeout_ms
                ),
            },
        },
    )
