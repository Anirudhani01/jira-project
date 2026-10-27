"""Identity use cases: signup, login, logout, password change, session management.

Contract (plan R2, V2.3, V2.4):
- Signup always yields 202 with no session, doing equivalent work for new and existing
  emails; it never reveals whether an account exists.
- Login failures are a generic 401; unknown emails cost the same as wrong passwords.
- Every login creates a new session; at most ``session_max_active`` stay active (LRU).
- Password change rotates the current session and revokes all others.
- (M2) Signup enqueues one of three emails (new / existing unverified / existing verified)
  in the same transaction; the response is identical in every case. Email verification
  rotates the current session (if it is the token owner's) and revokes the others;
  password reset revokes every session and never logs in (plan C3).
- (M2) Tokens arrive only in request bodies (taken from the URL fragment by the SPA), are
  looked up by SHA-256 hash, consumed atomically and rejected with one generic error.
"""

import uuid
from dataclasses import dataclass

from app.core.errors import AppError
from app.core.rate_limit import (
    LOGIN_PER_IP,
    LOGIN_PER_IP_EMAIL,
    PASSWORD_CHANGE_PER_USER,
    PASSWORD_RESET_PER_ADDRESS,
    PASSWORD_RESET_PER_IP,
    SIGNUP_EMAIL_PER_ADDRESS,
    SIGNUP_PER_IP,
    TOKEN_FAILURES_PER_IP,
    RateLimit,
    Reservation,
)
from app.core.security import hash_token, new_session_token
from app.db.tenant import TenantContext, bind_auth_email, bind_tenant
from app.modules.identity import repository
from app.modules.identity.deps import AuthContext, IdentityServices
from app.modules.identity.emails import (
    RESET_PASSWORD,
    TOPIC_PASSWORD_RESET,
    TOPIC_SIGNUP_EXISTING,
    TOPIC_VERIFY,
    VERIFY_EMAIL,
)
from app.modules.identity.models import User, UserSession
from app.modules.identity.passwords import PasswordRejectedError, enforce_password_policy
from app.modules.outbox import service as outbox
from app.modules.security_events import service as events
from app.modules.security_events.service import ClientInfo


def invalid_credentials() -> AppError:
    return AppError(401, "invalid_credentials", "Email or password is incorrect.")


@dataclass(frozen=True, slots=True)
class IssuedSession:
    session_id: uuid.UUID
    token: str


def password_rejected(message: str, field: str) -> AppError:
    return AppError(
        422,
        "password_rejected",
        "The password does not meet the policy.",
        errors=[{"field": f"body.{field}", "message": message}],
    )


async def _reserve(
    services: IdentityServices, rule: RateLimit, subject: str, client: ClientInfo
) -> Reservation:
    """Atomically take a rate-limit slot or fail with 429 (no check-then-act race)."""
    acquired = await services.limiter.acquire(rule, subject)
    if acquired.reservation is not None:
        return acquired.reservation
    await events.record_isolated(
        services.sessionmaker, "auth.rate_limited", "failure", client, metadata={"rule": rule.name}
    )
    raise AppError(
        429,
        "rate_limited",
        "Too many attempts. Try again later.",
        headers={"Retry-After": str(int(acquired.retry_after or 1) + 1)},
    )


async def _within_silent_limit(
    services: IdentityServices, rule: RateLimit, subject: str, client: ClientInfo
) -> bool:
    """Per-address email limits never change the response (that would reveal whether
    the account exists): over the limit, the email is simply not sent."""
    acquired = await services.limiter.acquire(rule, subject)
    if acquired.blocked:
        await events.record_isolated(
            services.sessionmaker,
            "auth.rate_limited",
            "failure",
            client,
            email_hmac=services.keys.email_hmac(subject),
            metadata={"rule": rule.name},
        )
    return not acquired.blocked


class _TokenRejectedError(Exception):
    """Internal: abort (roll back) a token transaction; surfaced as ``invalid_token``."""


def invalid_token() -> AppError:
    return AppError(400, "invalid_token", "This link is invalid or has expired.")


async def _reject_token(services: IdentityServices, purpose: str, client: ClientInfo) -> AppError:
    await events.record_isolated(
        services.sessionmaker,
        "auth.token.rejected",
        "failure",
        client,
        metadata={"purpose": purpose},
    )
    return invalid_token()


# ------------------------------------------------------------------------------ signup
async def signup(
    services: IdentityServices, *, email: str, password: str, display_name: str, client: ClientInfo
) -> None:
    # Every signup attempt counts (never released), whatever the outcome.
    await _reserve(services, SIGNUP_PER_IP, client.ip or "unknown", client)
    try:
        check = await enforce_password_policy(
            password,
            email=email,
            display_name=display_name,
            breach_checker=services.breach_checker,
        )
    except PasswordRejectedError as exc:
        raise password_rejected(str(exc), "password") from exc
    # Hash unconditionally: the existing-account path must cost the same as a new one.
    password_hash = await services.hashing.hash(password)
    send_email = await _within_silent_limit(services, SIGNUP_EMAIL_PER_ADDRESS, email, client)
    async with services.sessionmaker() as session, session.begin():
        await bind_auth_email(session, email)
        created_id = await repository.insert_user_if_absent(
            session, email=email, display_name=display_name, password_hash=password_hash
        )
        # Both paths read the row back, so the database work is the same.
        user = await repository.get_user_by_email(session, email)
        if send_email and user is not None and user.status == "active":
            if created_id is not None or user.email_verified_at is None:
                await outbox.enqueue(session, TOPIC_VERIFY, {"user_id": user.id})
            else:
                await outbox.enqueue(session, TOPIC_SIGNUP_EXISTING, {"user_id": user.id})
        await events.record(
            session,
            "auth.signup.requested",
            "info",
            client,
            email_hmac=services.keys.email_hmac(email),
            metadata={"breach_check": check.breach_check},
        )


# ------------------------------------------------------------------------------- login
async def login(
    services: IdentityServices, *, email: str, password: str, client: ClientInfo
) -> IssuedSession:
    ip = client.ip or "unknown"
    # Slots are reserved before verification so concurrent guesses are counted; they are
    # released on success, so only failed attempts consume the budget.
    per_ip = await _reserve(services, LOGIN_PER_IP, ip, client)
    try:
        per_ip_email = await _reserve(services, LOGIN_PER_IP_EMAIL, f"{ip}|{email}", client)
    except AppError:
        await services.limiter.release(per_ip)
        raise

    async with services.sessionmaker() as session, session.begin():
        await bind_auth_email(session, email)
        user = await repository.get_user_by_email(session, email)
    stored_hash = user.password_hash if user is not None else None
    verified = await services.hashing.verify(stored_hash, password)

    if not verified or user is None or user.status != "active":
        await events.record_isolated(
            services.sessionmaker,
            "auth.login.failed",
            "failure",
            client,
            user_id=user.id if user is not None else None,
            email_hmac=None if user is not None else services.keys.email_hmac(email),
            reason="disabled" if verified and user is not None else "invalid_credentials",
        )
        raise invalid_credentials()

    rehashed = services.hashing.needs_rehash(user.password_hash)
    new_hash = await services.hashing.hash(password) if rehashed else None
    settings = services.settings
    token = new_session_token()
    async with services.sessionmaker() as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=None, user_id=user.id))
        await repository.lock_user_sessions(session, user.id)
        # The password may have changed (or the account been disabled) while it was being
        # verified outside this transaction: never issue a session for stale credentials.
        current = await repository.get_user_by_id(session, user.id)
        if current is None or current.password_hash != stored_hash or current.status != "active":
            raise invalid_credentials()
        evicted = await repository.revoke_least_recently_used(
            session,
            user.id,
            keep=settings.session_max_active - 1,
            idle_seconds=settings.session_idle_ttl_seconds,
        )
        session_id = await repository.create_session(
            session,
            user_id=user.id,
            token_hash=hash_token(token),
            absolute_seconds=settings.session_absolute_ttl_seconds,
            ip=client.ip,
            user_agent=client.user_agent,
        )
        if new_hash is not None:
            await repository.update_password_hash_only(session, user.id, new_hash)
        await events.record(
            session,
            "auth.login.succeeded",
            "success",
            client,
            user_id=user.id,
            metadata={"sessions_evicted": evicted, "rehashed": rehashed},
        )
    await services.limiter.release(per_ip)
    await services.limiter.release(per_ip_email)
    return IssuedSession(session_id=session_id, token=token)


# ------------------------------------------------------------------------------ logout
async def logout(services: IdentityServices, auth: AuthContext, client: ClientInfo) -> None:
    async with services.sessionmaker() as session, session.begin():
        revoked = await repository.revoke_session(
            session, user_id=auth.user_id, session_id=auth.session_id, reason="logout"
        )
        if revoked:
            await events.record(session, "auth.logout", "success", client, user_id=auth.user_id)


# ---------------------------------------------------------------------------- account
async def get_user(services: IdentityServices, user_id: uuid.UUID) -> User:
    async with services.sessionmaker() as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=None, user_id=user_id))
        user = await repository.get_user_by_id(session, user_id)
    if user is None:
        raise AppError(401, "unauthenticated", "Authentication required.")
    return user


async def update_profile(
    services: IdentityServices, auth: AuthContext, *, display_name: str
) -> User:
    async with services.sessionmaker() as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=None, user_id=auth.user_id))
        await repository.update_display_name(session, auth.user_id, display_name)
    return await get_user(services, auth.user_id)


async def change_password(
    services: IdentityServices,
    auth: AuthContext,
    *,
    current_password: str,
    new_password: str,
    client: ClientInfo,
) -> IssuedSession:
    attempt = await _reserve(services, PASSWORD_CHANGE_PER_USER, str(auth.user_id), client)
    user = await get_user(services, auth.user_id)
    if not await services.hashing.verify(user.password_hash, current_password):
        raise AppError(
            422,
            "invalid_current_password",
            "The current password is incorrect.",
            errors=[{"field": "body.current_password", "message": "is incorrect"}],
        )
    await services.limiter.release(attempt)  # only wrong current-password guesses count
    try:
        check = await enforce_password_policy(
            new_password,
            email=user.email,
            display_name=user.display_name,
            breach_checker=services.breach_checker,
        )
    except PasswordRejectedError as exc:
        raise password_rejected(str(exc), "new_password") from exc
    new_hash = await services.hashing.hash(new_password)
    token = new_session_token()
    async with services.sessionmaker() as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=None, user_id=auth.user_id))
        await repository.lock_user_sessions(session, auth.user_id)
        await repository.update_password(session, auth.user_id, new_hash)
        revoked = await repository.revoke_user_sessions(
            session, user_id=auth.user_id, reason="password_changed"
        )
        session_id = await repository.create_session(
            session,
            user_id=auth.user_id,
            token_hash=hash_token(token),
            absolute_seconds=services.settings.session_absolute_ttl_seconds,
            ip=client.ip,
            user_agent=client.user_agent,
        )
        await events.record(
            session,
            "auth.password.changed",
            "success",
            client,
            user_id=auth.user_id,
            metadata={"breach_check": check.breach_check, "sessions_revoked": revoked},
        )
    return IssuedSession(session_id=session_id, token=token)


async def list_sessions(services: IdentityServices, auth: AuthContext) -> list[UserSession]:
    async with services.sessionmaker() as session, session.begin():
        return await repository.list_active_sessions(
            session, auth.user_id, idle_seconds=services.settings.session_idle_ttl_seconds
        )


async def revoke_one(
    services: IdentityServices, auth: AuthContext, session_id: uuid.UUID, client: ClientInfo
) -> None:
    async with services.sessionmaker() as session, session.begin():
        revoked = await repository.revoke_session(
            session, user_id=auth.user_id, session_id=session_id, reason="user_revoked"
        )
        if not revoked:
            raise AppError(404, "not_found")
        await events.record(
            session,
            "auth.session.revoked",
            "success",
            client,
            user_id=auth.user_id,
            metadata={"scope": "current" if session_id == auth.session_id else "one", "count": 1},
        )


async def revoke_others(services: IdentityServices, auth: AuthContext, client: ClientInfo) -> int:
    async with services.sessionmaker() as session, session.begin():
        count = await repository.revoke_user_sessions(
            session, user_id=auth.user_id, reason="user_revoked_others", except_id=auth.session_id
        )
        await events.record(
            session,
            "auth.session.revoked",
            "success",
            client,
            user_id=auth.user_id,
            metadata={"scope": "others", "count": count},
        )
    return count


# ------------------------------------------------------------------- email verification
async def verify_email(
    services: IdentityServices, *, token: str, auth: AuthContext | None, client: ClientInfo
) -> IssuedSession | None:
    """Consume a verification token. Returns a rotated session when the caller's current
    session belongs to the token owner; every other session of the owner is revoked."""
    ip = client.ip or "unknown"
    attempt = await _reserve(services, TOKEN_FAILURES_PER_IP, ip, client)
    new_token = new_session_token()
    issued: IssuedSession | None = None
    try:
        async with services.sessionmaker() as session, session.begin():
            user_id = await repository.consume_token(session, hash_token(token), VERIFY_EMAIL)
            if user_id is None:
                raise _TokenRejectedError
            await bind_tenant(session, TenantContext(org_id=None, user_id=user_id))
            user = await repository.get_user_by_id(session, user_id)
            if user is None or user.status != "active":
                raise _TokenRejectedError  # rolls back the consume
            await repository.mark_email_verified(session, user_id)
            await repository.invalidate_user_tokens(session, user_id, (VERIFY_EMAIL,))
            await repository.lock_user_sessions(session, user_id)
            rotate = auth is not None and auth.user_id == user_id
            revoked = await repository.revoke_user_sessions(
                session, user_id=user_id, reason="email_verified"
            )
            if rotate:
                session_id = await repository.create_session(
                    session,
                    user_id=user_id,
                    token_hash=hash_token(new_token),
                    absolute_seconds=services.settings.session_absolute_ttl_seconds,
                    ip=client.ip,
                    user_agent=client.user_agent,
                )
                issued = IssuedSession(session_id=session_id, token=new_token)
            await events.record(
                session,
                "auth.email.verified",
                "success",
                client,
                user_id=user_id,
                metadata={"sessions_revoked": revoked, "rotated": rotate},
            )
    except _TokenRejectedError:
        raise await _reject_token(services, VERIFY_EMAIL, client) from None
    await services.limiter.release(attempt)
    return issued


# ---------------------------------------------------------------------- password reset
async def request_password_reset(
    services: IdentityServices, *, email: str, client: ClientInfo
) -> None:
    """Succeeds (202) for known and unknown emails alike. Both paths look the address up,
    enqueue one job (a no-op job for unknown addresses) and record one event. While email
    delivery is disabled the request fails with 503 for every address."""
    if not services.settings.email_delivery_enabled:
        # A global condition, identical for every address (reveals nothing about accounts):
        # never answer "accepted" when no email can be sent.
        raise AppError(
            503,
            "email_unavailable",
            "Password reset by email is not available right now.",
        )
    await _reserve(services, PASSWORD_RESET_PER_IP, client.ip or "unknown", client)
    send_email = await _within_silent_limit(services, PASSWORD_RESET_PER_ADDRESS, email, client)
    async with services.sessionmaker() as session, session.begin():
        await bind_auth_email(session, email)
        user = await repository.get_user_by_email(session, email)
        target = user.id if user is not None and user.status == "active" else None
        if send_email:
            await outbox.enqueue(session, TOPIC_PASSWORD_RESET, {"user_id": target})
        await events.record(
            session,
            "auth.password_reset.requested",
            "info",
            client,
            user_id=target,
            email_hmac=None if target is not None else services.keys.email_hmac(email),
        )


async def confirm_password_reset(
    services: IdentityServices, *, token: str, new_password: str, client: ClientInfo
) -> None:
    """Set a new password with a reset token. Revokes every session, marks the email
    verified (the owner proved control of it) and never creates a session."""
    ip = client.ip or "unknown"
    attempt = await _reserve(services, TOKEN_FAILURES_PER_IP, ip, client)
    token_hash = hash_token(token)
    async with services.sessionmaker() as session, session.begin():
        user_id = await repository.find_usable_token_user(session, token_hash, RESET_PASSWORD)
        user = None
        if user_id is not None:
            await bind_tenant(session, TenantContext(org_id=None, user_id=user_id))
            user = await repository.get_user_by_id(session, user_id)
    if user is None or user.status != "active":
        raise await _reject_token(services, RESET_PASSWORD, client)
    await services.limiter.release(attempt)
    # The token is not consumed by a policy rejection, so the user can pick another password.
    try:
        check = await enforce_password_policy(
            new_password,
            email=user.email,
            display_name=user.display_name,
            breach_checker=services.breach_checker,
        )
    except PasswordRejectedError as exc:
        raise password_rejected(str(exc), "new_password") from exc
    new_hash = await services.hashing.hash(new_password)
    async with services.sessionmaker() as session, session.begin():
        consumed = await repository.consume_token(session, token_hash, RESET_PASSWORD)
        if consumed == user.id:
            await bind_tenant(session, TenantContext(org_id=None, user_id=user.id))
            await repository.lock_user_sessions(session, user.id)
            await repository.update_password(session, user.id, new_hash)
            await repository.mark_email_verified(session, user.id)
            await repository.invalidate_user_tokens(
                session, user.id, (RESET_PASSWORD, VERIFY_EMAIL)
            )
            revoked = await repository.revoke_user_sessions(
                session, user_id=user.id, reason="password_reset"
            )
            await events.record(
                session,
                "auth.password.reset",
                "success",
                client,
                user_id=user.id,
                metadata={"breach_check": check.breach_check, "sessions_revoked": revoked},
            )
    if consumed != user.id:
        # Used concurrently (or expired) between the check and the consume.
        raise await _reject_token(services, RESET_PASSWORD, client)
