"""Helpers for M2 email tests: run the real worker against the test database and read
delivered messages from Mailpit (free local SMTP sink, started by `make infra-up`)."""

import asyncio
import os
import re
from typing import Any

import httpx
from pydantic import SecretStr

from app.core.mailer import Mailer, SmtpMailer
from app.db.engine import create_db_engine
from app.db.session import create_sessionmaker
from app.worker.main import Handler, Worker
from tests.integration.auth_support import integration_settings, superuser_sql

TOKEN_IN_LINK = re.compile(r"(?P<path>/[a-z-]+)#token=(?P<token>[A-Za-z0-9_-]+)")


def worker_settings(**overrides: Any) -> Any:
    values: dict[str, Any] = {
        "worker_database_url": SecretStr(os.environ["TEST_WORKER_DATABASE_URL"]),
    }
    values.update(overrides)
    return integration_settings(**values)


async def run_worker(
    *,
    mailer: Mailer | None = None,
    handlers: dict[str, Handler] | None = None,
    stop_before_processing: bool = False,
    **overrides: Any,
) -> int:
    """Run the worker until the queue is drained (as app_worker). Returns jobs claimed."""
    settings = worker_settings(**overrides)
    engine = create_db_engine(
        settings, application_name="test-worker", url=settings.worker_database_url
    )
    try:
        worker = Worker(
            settings, create_sessionmaker(engine), mailer or SmtpMailer(settings), handlers=handlers
        )
        if stop_before_processing:
            worker.stopping.set()
            return await worker.run_once()
        total = 0
        while claimed := await worker.run_once():
            total += claimed
        return total
    finally:
        await engine.dispose()


async def settle_outbox() -> None:
    """Mark every pending job processed (as superuser) so a test starts from an empty queue."""
    await superuser_sql(
        "UPDATE outbox SET processed_at = now(), locked_until = NULL "
        "WHERE processed_at IS NULL AND dead_at IS NULL"
    )


async def mailpit_messages(to: str, *, expected: int | None = None) -> list[dict[str, Any]]:
    """Messages delivered to ``to``, oldest first, each with its plain-text body."""
    base = os.environ["TEST_MAILPIT_URL"]
    async with httpx.AsyncClient(base_url=base, timeout=5) as http:
        for _ in range(50):
            found = (await http.get("/api/v1/search", params={"query": f'to:"{to}"'})).json()
            summaries = found["messages"]
            if expected is None or len(summaries) >= expected:
                break
            await asyncio.sleep(0.1)
        messages = []
        for summary in sorted(summaries, key=lambda m: m["Created"]):
            messages.append((await http.get(f"/api/v1/message/{summary['ID']}")).json())
        return messages


def token_from(message: dict[str, Any], path: str) -> str:
    match = TOKEN_IN_LINK.search(message["Text"])
    assert match is not None, "no token link in message"
    assert match.group("path") == path
    return match.group("token")


def token_for(messages: list[dict[str, Any]], path: str) -> str:
    """Token of the single message linking to ``path``; delivery order is not relied on
    (messages sent in the same instant share a Mailpit timestamp)."""
    matching = [
        m
        for m in messages
        if (link := TOKEN_IN_LINK.search(m["Text"])) and link.group("path") == path
    ]
    assert len(matching) == 1, f"expected one {path} message, found {len(matching)}"
    return token_from(matching[0], path)
