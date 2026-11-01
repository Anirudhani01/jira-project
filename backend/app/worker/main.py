"""Background worker: outbox delivery (M2), org auth reconciliation (A3.2), retention (M12).

Run with ``python -m app.worker``. Connects as ``app_worker`` (WORKER_DATABASE_URL),
checks that role at startup like the API does, and stops gracefully on SIGTERM/SIGINT:
the job in progress finishes, unstarted claimed jobs are released, and anything else is
recovered by lease expiry. Org auth reconciliation and retention run on separate asyncio
tasks; failures there do not stop outbox polling.
"""

import asyncio
import logging
import signal
import uuid
from collections.abc import Awaitable, Callable
from contextlib import suppress

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.core.mailer import Mailer, SmtpMailer
from app.db.engine import create_db_engine
from app.db.role_check import verify_runtime_role
from app.db.session import create_sessionmaker
from app.modules.identity.emails import EMAIL_TOPICS, EmailJob, handle_email_job
from app.modules.orgs.emails import handle_invitation_job
from app.modules.orgs.members import TOPIC_ORG_INVITATION
from app.modules.outbox import repository as outbox
from app.modules.outbox.repository import ClaimedJob
from app.worker.org_auth_reconciliation import org_auth_reconciliation_loop
from app.worker.retention import run_purge

logger = logging.getLogger("app.worker")

Handler = Callable[[ClaimedJob], Awaitable[str]]


class PermanentJobError(ValueError):
    """The job can never succeed as written (bad payload, unknown topic)."""


def _user_id(job: ClaimedJob) -> uuid.UUID | None:
    value = job.payload.get("user_id")
    if value is None:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise PermanentJobError("invalid user_id") from exc


class Worker:
    def __init__(
        self,
        settings: Settings,
        sessionmaker: async_sessionmaker[AsyncSession],
        mailer: Mailer,
        *,
        handlers: dict[str, Handler] | None = None,
    ) -> None:
        self.settings = settings
        self.sessionmaker = sessionmaker
        self.mailer = mailer
        self.handlers: dict[str, Handler] = handlers or {
            **dict.fromkeys(EMAIL_TOPICS, self._email),
            TOPIC_ORG_INVITATION: self._invitation,
        }
        self.stopping = asyncio.Event()

    async def _email(self, job: ClaimedJob) -> str:
        if job.org_id is not None:
            # Identity emails are platform jobs; one carrying an org is malformed.
            raise PermanentJobError("platform job with org_id")
        if not self.settings.email_delivery_enabled:
            # Nothing is sent until a provider is explicitly configured; no token is minted.
            return "skipped_delivery_disabled"
        return await handle_email_job(
            EmailJob(job_id=job.id, topic=job.topic, user_id=_user_id(job)),
            settings=self.settings,
            sessionmaker=self.sessionmaker,
            mailer=self.mailer,
        )

    async def _invitation(self, job: ClaimedJob) -> str:
        if job.org_id is None:
            raise PermanentJobError("tenant job without org_id")
        if not self.settings.email_delivery_enabled:
            return "skipped_delivery_disabled"
        value = job.payload.get("invitation_id")
        try:
            invitation_id = uuid.UUID(str(value))
        except ValueError as exc:
            raise PermanentJobError("invalid invitation_id") from exc
        return await handle_invitation_job(
            job_id=job.id,
            org_id=job.org_id,
            invitation_id=invitation_id,
            settings=self.settings,
            sessionmaker=self.sessionmaker,
            mailer=self.mailer,
        )

    async def run_once(self) -> int:
        """Claim one batch and process it. Returns the number of jobs claimed."""
        settings = self.settings
        async with self.sessionmaker() as session, session.begin():
            jobs = await outbox.claim(
                session,
                batch=settings.worker_batch_size,
                lease_seconds=settings.worker_lease_seconds,
            )
        for index, job in enumerate(jobs):
            if self.stopping.is_set():
                async with self.sessionmaker() as session, session.begin():
                    for pending in jobs[index:]:
                        await outbox.release(session, pending)
                break
            await self._process(job)
        return len(jobs)

    async def _process(self, job: ClaimedJob) -> None:
        log = {"job_id": job.id, "topic": job.topic, "attempts": job.attempts}
        if job.attempts > self.settings.worker_max_attempts:
            # Claimed max_attempts times without an ack (e.g. repeated crashes mid-job).
            await self._fail(job, "lease_expired", log, permanent=True)
            return
        handler = self.handlers.get(job.topic)
        try:
            if handler is None:
                raise PermanentJobError("unknown topic")
            outcome = await handler(job)
        except Exception as exc:
            # Only the exception type is stored/logged: messages may contain addresses.
            permanent = isinstance(exc, PermanentJobError)
            await self._fail(job, type(exc).__name__, log, permanent=permanent)
            return
        async with self.sessionmaker() as session, session.begin():
            acked = await outbox.ack(session, job)
        logger.info(
            "outbox job processed",
            extra={
                "event": "outbox.processed",
                "outcome": outcome if acked else "lease_lost",
                **log,
            },
        )

    async def _fail(
        self, job: ClaimedJob, error: str, log: dict[str, object], *, permanent: bool = False
    ) -> None:
        max_attempts = job.attempts if permanent else self.settings.worker_max_attempts
        async with self.sessionmaker() as session, session.begin():
            dead = await outbox.fail(session, job, error=error, max_attempts=max_attempts)
        logger.warning(
            "outbox job failed",
            extra={
                "event": "outbox.dead" if dead else "outbox.retry",
                "error_type": error,
                **log,
            },
        )

    async def run(self) -> None:
        logger.info("worker started", extra={"event": "worker.started"})
        while not self.stopping.is_set():
            try:
                claimed = await self.run_once()
            except Exception as exc:  # database unavailable etc.: back off, keep running
                logger.error(
                    "outbox poll failed",
                    extra={"event": "outbox.poll_failed", "error_type": type(exc).__name__},
                )
                claimed = 0
            if claimed < self.settings.worker_batch_size:
                with suppress(TimeoutError):
                    await asyncio.wait_for(
                        self.stopping.wait(), timeout=self.settings.worker_poll_interval_seconds
                    )
        logger.info("worker stopped", extra={"event": "worker.stopped"})


async def retention_loop(settings: Settings, engine: AsyncEngine, stopping: asyncio.Event) -> None:
    """Periodic purge; a failure is logged and retried at the next interval."""
    while not stopping.is_set():
        try:
            if await run_purge(engine) is None:
                logger.info("retention purge skipped", extra={"event": "retention.locked"})
        except Exception as exc:
            logger.error(
                "retention purge failed",
                extra={"event": "retention.failed", "error_type": type(exc).__name__},
            )
        with suppress(TimeoutError):
            await asyncio.wait_for(stopping.wait(), timeout=settings.retention_interval_seconds)


async def run_worker(settings: Settings) -> None:
    if settings.worker_database_url is None:
        raise SystemExit("WORKER_DATABASE_URL is required to run the worker")
    engine = create_db_engine(
        settings, application_name="jira-worker", url=settings.worker_database_url
    )
    try:
        await verify_runtime_role(engine, enforce=settings.enforce_db_role_checks)
        worker = Worker(settings, create_sessionmaker(engine), SmtpMailer(settings))
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, worker.stopping.set)
        org_auth_task = asyncio.create_task(
            org_auth_reconciliation_loop(settings, engine, worker.stopping)
        )
        retention_engine = None
        retention_task = None
        if settings.retention_database_url is not None:
            retention_engine = create_db_engine(
                settings, application_name="jira-retention", url=settings.retention_database_url
            )
            retention_task = asyncio.create_task(
                retention_loop(settings, retention_engine, worker.stopping)
            )
        await worker.run()
        await org_auth_task
        if retention_task is not None:
            await retention_task
        if retention_engine is not None:
            await retention_engine.dispose()
    finally:
        await engine.dispose()


def main() -> int:
    settings = get_settings()
    configure_logging(settings.log_level)
    asyncio.run(run_worker(settings))
    return 0
