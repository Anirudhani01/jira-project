"""Session factory and the explicit transaction helper.

Handlers use ``transaction()`` so the commit happens *inside* the handler, before the
response is built. A commit failure therefore surfaces as an error response instead
of a 2xx for work that was never persisted.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False, autoflush=False)


@asynccontextmanager
async def transaction(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncSession]:
    """Open a session in an explicit transaction; commit on success, roll back on error."""
    async with sessionmaker() as session, session.begin():
        yield session
