"""Identity email jobs, executed by the worker (plan R2 M2, R4, C3, C4).

Tokens are minted here, at send time, by the worker role: the raw token exists only in
memory and in the delivered email, never in the outbox or the database (SHA-256 only).
Links carry the token in the URL fragment, which browsers never send to servers.
At most ``max_active_tokens_per_purpose`` tokens stay usable per user and purpose, so a
duplicate delivery (at-least-once) never breaks the link from the earlier email.
"""

import uuid
from dataclasses import dataclass
from typing import Final, Literal

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.mailer import EmailDeliveryDisabledError, Mailer, OutgoingEmail
from app.core.security import hash_token, new_session_token
from app.db.tenant import TenantContext, bind_tenant
from app.modules.identity import repository

VERIFY_EMAIL: Final = "verify_email"
RESET_PASSWORD: Final = "reset_password"  # noqa: S105 - token purpose, not a secret

TOPIC_VERIFY: Final = "email.verify"
TOPIC_SIGNUP_EXISTING: Final = "email.signup_existing"
TOPIC_PASSWORD_RESET: Final = "email.password_reset"  # noqa: S105 - topic name
EMAIL_TOPICS: Final = frozenset({TOPIC_VERIFY, TOPIC_SIGNUP_EXISTING, TOPIC_PASSWORD_RESET})

Outcome = Literal["sent", "skipped"]


@dataclass(frozen=True, slots=True)
class EmailJob:
    job_id: int
    topic: str
    user_id: uuid.UUID | None


@dataclass(frozen=True, slots=True)
class _Recipient:
    email: str
    display_name: str
    verified: bool


def _link(settings: Settings, path: str, token: str | None = None) -> str:
    base = settings.app_base_url.rstrip("/")
    return f"{base}{path}#token={token}" if token else f"{base}{path}"


def _verify_message(settings: Settings, to: _Recipient, token: str) -> tuple[str, str]:
    hours = settings.verify_email_token_ttl_seconds // 3600
    return (
        "Verify your email address",
        f"Hello {to.display_name},\n\n"
        "Confirm your email address by opening this link:\n\n"
        f"{_link(settings, '/verify-email', token)}\n\n"
        f"The link expires in {hours} hours and can be used once. If you did not create an "
        "account, you can ignore this email.\n",
    )


def _signup_existing_message(settings: Settings, to: _Recipient) -> tuple[str, str]:
    return (
        "Sign-up attempt with your email address",
        f"Hello {to.display_name},\n\n"
        "Someone tried to create an account with this email address, but you already "
        "have one. No changes were made.\n\n"
        "If this was you, sign in instead. If you have forgotten your password, reset it "
        f"here:\n\n{_link(settings, '/forgot-password')}\n\n"
        "If this was not you, you can ignore this email.\n",
    )


def _reset_message(settings: Settings, to: _Recipient, token: str) -> tuple[str, str]:
    minutes = settings.reset_password_token_ttl_seconds // 60
    return (
        "Reset your password",
        f"Hello {to.display_name},\n\n"
        "Choose a new password by opening this link:\n\n"
        f"{_link(settings, '/reset-password', token)}\n\n"
        f"The link expires in {minutes} minutes and can be used once. Resetting your "
        "password signs you out everywhere. If you did not ask for this, you can ignore "
        "this email; your password stays unchanged.\n",
    )


async def _recipient(session: AsyncSession, user_id: uuid.UUID) -> _Recipient | None:
    await bind_tenant(session, TenantContext(org_id=None, user_id=user_id))
    user = await repository.get_user_by_id(session, user_id)
    if user is None or user.status != "active":
        return None
    return _Recipient(
        email=user.email,
        display_name=user.display_name,
        verified=user.email_verified_at is not None,
    )


async def _mint(
    session: AsyncSession, settings: Settings, user_id: uuid.UUID, purpose: str, ttl: int
) -> str:
    token = new_session_token()
    await repository.lock_user_tokens(session, user_id, purpose)
    await repository.invalidate_tokens_beyond(
        session, user_id, purpose, keep=settings.max_active_tokens_per_purpose - 1
    )
    await repository.insert_token(
        session, user_id=user_id, purpose=purpose, token_hash=hash_token(token), ttl_seconds=ttl
    )
    return token


async def handle_email_job(
    job: EmailJob,
    *,
    settings: Settings,
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
) -> Outcome:
    """Build and send one email. The token (if any) is committed before sending, so a
    delivered link always works. If sending fails, that attempt's token is invalidated: an
    undelivered token must never count toward the active-token cap and push out a link the
    user actually received."""
    if job.topic not in EMAIL_TOPICS:
        raise ValueError(f"not an email topic: {job.topic}")
    if not settings.email_delivery_enabled:
        # Checked before anything is minted: no token may exist for an email never sent.
        raise EmailDeliveryDisabledError("email delivery is disabled")
    if job.user_id is None:
        # Unknown email on reset request: enqueued only so both paths do equal work.
        return "skipped"
    token: str | None = None
    async with sessionmaker() as session, session.begin():
        to = await _recipient(session, job.user_id)
        if to is None:
            return "skipped"
        if job.topic == TOPIC_VERIFY:
            if to.verified:
                return "skipped"
            token = await _mint(
                session,
                settings,
                job.user_id,
                VERIFY_EMAIL,
                settings.verify_email_token_ttl_seconds,
            )
            subject, body = _verify_message(settings, to, token)
        elif job.topic == TOPIC_SIGNUP_EXISTING:
            subject, body = _signup_existing_message(settings, to)
        else:
            token = await _mint(
                session,
                settings,
                job.user_id,
                RESET_PASSWORD,
                settings.reset_password_token_ttl_seconds,
            )
            subject, body = _reset_message(settings, to, token)
    try:
        await mailer.send(
            OutgoingEmail(
                to=to.email, subject=subject, body=body, idempotency_key=f"outbox-{job.job_id}"
            )
        )
    except Exception:
        if token is not None:
            async with sessionmaker() as session, session.begin():
                await repository.invalidate_token(session, hash_token(token))
        raise
    return "sent"
