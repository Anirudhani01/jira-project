"""Operator/developer CLI.

``python -m app.cli users verify <email>``: dev/test only (plan V2.3): there is no HTTP
bypass for email verification, and this command refuses to run when ENVIRONMENT is
staging or prod. It connects with the runtime role (DATABASE_URL), so RLS applies, and
records a platform security event.

``python -m app.cli outbox list-dead`` / ``outbox requeue <id>`` (plan R5): inspect and
retry dead-lettered jobs, in any environment, as the worker role (WORKER_DATABASE_URL).
Output shows ids, topics and error types only; payloads are never printed.
"""

import argparse
import asyncio
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.security import normalize_email
from app.db.engine import create_db_engine
from app.db.session import create_sessionmaker
from app.db.tenant import TenantContext, bind_auth_email, bind_tenant
from app.modules.identity import repository
from app.modules.outbox import repository as outbox
from app.modules.security_events import service as events
from app.modules.security_events.service import ClientInfo

ALLOWED_ENVIRONMENTS = frozenset({"dev", "test"})


class CliError(RuntimeError):
    pass


async def verify_user(settings: Settings, email: str) -> None:
    if settings.environment not in ALLOWED_ENVIRONMENTS:
        raise CliError(f"refusing to run in ENVIRONMENT={settings.environment} (dev/test only)")
    email = normalize_email(email)
    engine = create_db_engine(settings, application_name="jira-cli")
    try:
        sessionmaker = create_sessionmaker(engine)
        async with sessionmaker() as session, session.begin():
            await bind_auth_email(session, email)
            user = await repository.get_user_by_email(session, email)
            if user is None:
                raise CliError("no user with that email")
            await bind_tenant(session, TenantContext(org_id=None, user_id=user.id))
            await repository.mark_email_verified(session, user.id)
            await events.record(
                session,
                "user.verified_by_cli",
                "success",
                ClientInfo(ip=None, user_agent="app.cli"),
                user_id=user.id,
            )
    finally:
        await engine.dispose()


async def list_dead_jobs(settings: Settings) -> list[outbox.DeadJob]:
    async with _worker_session(settings) as session:
        return await outbox.list_dead(session)


async def requeue_job(settings: Settings, job_id: int) -> None:
    async with _worker_session(settings) as session:
        if not await outbox.requeue(session, job_id):
            raise CliError("no dead-lettered job with that id")


@asynccontextmanager
async def _worker_session(settings: Settings) -> AsyncIterator[AsyncSession]:
    if settings.worker_database_url is None:
        raise CliError("WORKER_DATABASE_URL is required for outbox commands")
    engine = create_db_engine(
        settings, application_name="jira-cli", url=settings.worker_database_url
    )
    try:
        async with create_sessionmaker(engine)() as session, session.begin():
            yield session
    finally:
        await engine.dispose()


def _run(args: argparse.Namespace) -> str:
    settings = get_settings()
    if args.group == "users":
        asyncio.run(verify_user(settings, args.email))
        return "verified"
    if args.command == "requeue":
        asyncio.run(requeue_job(settings, args.job_id))
        return f"requeued {args.job_id}"
    jobs = asyncio.run(list_dead_jobs(settings))
    lines = [
        f"{job.id}\t{job.topic}\tattempts={job.attempts}\terror={job.last_error or '-'}"
        f"\tdead_at={job.dead_at.isoformat()}"
        for job in jobs
    ]
    return "\n".join(lines) if lines else "no dead-lettered jobs"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    groups = parser.add_subparsers(dest="group", required=True)
    users = groups.add_parser("users").add_subparsers(dest="command", required=True)
    verify = users.add_parser("verify", help="mark a user's email as verified (dev/test only)")
    verify.add_argument("email")
    jobs = groups.add_parser("outbox").add_subparsers(dest="command", required=True)
    jobs.add_parser("list-dead", help="list dead-lettered outbox jobs")
    requeue = jobs.add_parser("requeue", help="return a dead-lettered job to the queue")
    requeue.add_argument("job_id", type=int)
    args = parser.parse_args(argv)
    try:
        print(_run(args))
    except CliError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
