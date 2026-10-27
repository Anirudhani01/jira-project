"""Identity use cases: signup, login, logout, password change, session management.

Contract (plan R2, V2.3, V2.4):
- Signup always yields 202 with no session, doing equivalent work for new and existing
  emails; it never reveals whether an account exists.
- Login failures are a generic 401; unknown emails cost the same as wrong passwords.
- Every login creates a new session; at most ``session_max_active`` stay active (LRU).
- Password change rotates the current session and revokes all others.
"""

import uuid
from dataclasses import dataclass

from app.core.errors import AppError
from app.core.rate_limit import (
    LOGIN_PER_IP,
    LOGIN_PER_IP_EMAIL,
    PASSWORD_CHANGE_PER_USER,
    SIGNUP_PER_IP,
    RateLimit,
    Reservation,
)
from app.core.security import hash_token, new_session_token
from app.db.tenant import TenantContext, bind_auth_email, bind_tenant
from app.modules.identity import repository
from app.modules.identity.deps import AuthContext, IdentityServices
from app.modules.identity.models import User, UserSession
from app.modules.identity.passwords import PasswordRejectedError, enforce_password_policy
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
    async with services.sessionmaker() as session, session.begin():
        await bind_auth_email(session, email)
        await repository.insert_user_if_absent(
            session, email=email, display_name=display_name, password_hash=password_hash
        )
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
