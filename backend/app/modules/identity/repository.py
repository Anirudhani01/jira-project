"""Data access for users and sessions. The only module that touches these tables.

Session validity (not revoked, before absolute expiry, within the idle window) is
always evaluated with the database clock (``now()``), never the application clock.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.identity.models import User, UserSession, UserToken


@dataclass(frozen=True, slots=True)
class SessionRecord:
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    needs_touch: bool


def _active(idle_seconds: int) -> ColumnElement[bool]:
    return (
        UserSession.revoked_at.is_(None)
        & (UserSession.expires_at > func.now())
        & (
            UserSession.last_seen_at
            > func.now() - func.make_interval(0, 0, 0, 0, 0, 0, idle_seconds)
        )
    )


# ---------------------------------------------------------------------------- users
async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    """Requires ``bind_auth_email`` for this email (RLS)."""
    return (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()


async def get_user_by_id(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    """Requires the user context to be bound (RLS)."""
    return (await session.execute(select(User).where(User.id == user_id))).scalar_one_or_none()


async def insert_user_if_absent(
    session: AsyncSession, *, email: str, display_name: str, password_hash: str
) -> uuid.UUID | None:
    """INSERT ... ON CONFLICT DO NOTHING: concurrent duplicate signups both succeed.

    Returns the new user's id, or None when the email already existed.
    """
    statement = (
        pg_insert(User)
        .values(email=email, display_name=display_name, password_hash=password_hash)
        .on_conflict_do_nothing(index_elements=[User.email])
        .returning(User.id)
    )
    return (await session.execute(statement)).scalar_one_or_none()


async def update_password(session: AsyncSession, user_id: uuid.UUID, password_hash: str) -> None:
    await session.execute(
        update(User)
        .where(User.id == user_id)
        .values(password_hash=password_hash, password_changed_at=func.now(), updated_at=func.now())
    )


async def update_password_hash_only(
    session: AsyncSession, user_id: uuid.UUID, password_hash: str
) -> None:
    """Transparent rehash on login (parameters changed); not a password change."""
    await session.execute(
        update(User).where(User.id == user_id).values(password_hash=password_hash)
    )


async def update_display_name(session: AsyncSession, user_id: uuid.UUID, display_name: str) -> None:
    await session.execute(
        update(User)
        .where(User.id == user_id)
        .values(display_name=display_name, updated_at=func.now())
    )


async def mark_email_verified(session: AsyncSession, user_id: uuid.UUID) -> None:
    await session.execute(
        update(User)
        .where(User.id == user_id, User.email_verified_at.is_(None))
        .values(email_verified_at=func.now(), updated_at=func.now())
    )


# ------------------------------------------------------------------------- sessions
async def lock_user_sessions(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Serialize session creation per user so the active-session cap cannot be exceeded."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"user-sessions:{user_id}"},
    )


async def revoke_least_recently_used(
    session: AsyncSession, user_id: uuid.UUID, *, keep: int, idle_seconds: int
) -> int:
    """Revoke active sessions beyond the newest ``keep`` (by last_seen_at). Returns count."""
    active_ids = (
        select(UserSession.id)
        .where(UserSession.user_id == user_id, _active(idle_seconds))
        .order_by(UserSession.last_seen_at.desc(), UserSession.created_at.desc())
        .offset(keep)
    )
    result = await session.execute(
        update(UserSession)
        .where(UserSession.id.in_(active_ids))
        .values(revoked_at=func.now(), revoke_reason="session_cap")
        .returning(UserSession.id)
    )
    return len(result.all())


async def create_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    token_hash: bytes,
    absolute_seconds: int,
    ip: str | None,
    user_agent: str | None,
) -> uuid.UUID:
    statement = (
        pg_insert(UserSession)
        .values(
            user_id=user_id,
            token_hash=token_hash,
            expires_at=func.now() + func.make_interval(0, 0, 0, 0, 0, 0, absolute_seconds),
            ip=ip,
            user_agent=user_agent[:256] if user_agent else None,
        )
        .returning(UserSession.id)
    )
    return (await session.execute(statement)).scalar_one()


async def get_active_session(
    session: AsyncSession, token_hash: bytes, *, idle_seconds: int, touch_seconds: int
) -> SessionRecord | None:
    needs_touch = UserSession.last_seen_at < func.now() - func.make_interval(
        0, 0, 0, 0, 0, 0, touch_seconds
    )
    row = (
        await session.execute(
            select(
                UserSession.id,
                UserSession.user_id,
                UserSession.created_at,
                UserSession.last_seen_at,
                UserSession.expires_at,
                needs_touch.label("needs_touch"),
            ).where(UserSession.token_hash == token_hash, _active(idle_seconds))
        )
    ).one_or_none()
    if row is None:
        return None
    return SessionRecord(
        id=row.id,
        user_id=row.user_id,
        created_at=row.created_at,
        last_seen_at=row.last_seen_at,
        expires_at=row.expires_at,
        needs_touch=bool(row.needs_touch),
    )


async def touch_session(session: AsyncSession, session_id: uuid.UUID) -> None:
    await session.execute(
        update(UserSession).where(UserSession.id == session_id).values(last_seen_at=func.now())
    )


async def list_active_sessions(
    session: AsyncSession, user_id: uuid.UUID, *, idle_seconds: int
) -> list[UserSession]:
    result = await session.execute(
        select(UserSession)
        .where(UserSession.user_id == user_id, _active(idle_seconds))
        .order_by(UserSession.last_seen_at.desc())
    )
    return list(result.scalars())


async def revoke_session(
    session: AsyncSession, *, user_id: uuid.UUID, session_id: uuid.UUID, reason: str
) -> bool:
    """Revoke one of the user's own sessions. False if it is not theirs or already gone."""
    result = await session.execute(
        update(UserSession)
        .where(
            UserSession.id == session_id,
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
        )
        .values(revoked_at=func.now(), revoke_reason=reason)
        .returning(UserSession.id)
    )
    return result.first() is not None


async def revoke_user_sessions(
    session: AsyncSession, *, user_id: uuid.UUID, reason: str, except_id: uuid.UUID | None = None
) -> int:
    conditions = [UserSession.user_id == user_id, UserSession.revoked_at.is_(None)]
    if except_id is not None:
        conditions.append(UserSession.id != except_id)
    result = await session.execute(
        update(UserSession)
        .where(*conditions)
        .values(revoked_at=func.now(), revoke_reason=reason)
        .returning(UserSession.id)
    )
    return len(result.all())


# --------------------------------------------------------------------------- tokens
# Validity (unused, not invalidated, unexpired) is always evaluated with the DB clock.
def _token_usable(purpose: str) -> ColumnElement[bool]:
    return (
        (UserToken.purpose == purpose)
        & UserToken.used_at.is_(None)
        & UserToken.invalidated_at.is_(None)
        & (UserToken.expires_at > func.now())
    )


async def find_usable_token_user(
    session: AsyncSession, token_hash: bytes, purpose: str
) -> uuid.UUID | None:
    """The owner of a usable token, without consuming it."""
    return (
        await session.execute(
            select(UserToken.user_id).where(
                UserToken.token_hash == token_hash, _token_usable(purpose)
            )
        )
    ).scalar_one_or_none()


async def consume_token(session: AsyncSession, token_hash: bytes, purpose: str) -> uuid.UUID | None:
    """Atomically mark a usable token as used and return its owner.

    A single conditional UPDATE: of two concurrent submissions of the same token, the
    second blocks on the row lock, re-evaluates ``used_at IS NULL`` and matches nothing.
    """
    result = await session.execute(
        update(UserToken)
        .where(UserToken.token_hash == token_hash, _token_usable(purpose))
        .values(used_at=func.now())
        .returning(UserToken.user_id)
    )
    return result.scalar_one_or_none()


async def invalidate_user_tokens(
    session: AsyncSession, user_id: uuid.UUID, purposes: tuple[str, ...]
) -> int:
    result = await session.execute(
        update(UserToken)
        .where(
            UserToken.user_id == user_id,
            UserToken.purpose.in_(purposes),
            UserToken.used_at.is_(None),
            UserToken.invalidated_at.is_(None),
        )
        .values(invalidated_at=func.now())
        .returning(UserToken.id)
    )
    return len(result.all())


async def invalidate_token(session: AsyncSession, token_hash: bytes) -> None:
    """Withdraw one unused token (e.g. its email could not be sent)."""
    await session.execute(
        update(UserToken)
        .where(
            UserToken.token_hash == token_hash,
            UserToken.used_at.is_(None),
            UserToken.invalidated_at.is_(None),
        )
        .values(invalidated_at=func.now())
    )


async def lock_user_tokens(session: AsyncSession, user_id: uuid.UUID, purpose: str) -> None:
    """Serialize minting per user and purpose so the active-token cap cannot be exceeded."""
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"user-tokens:{purpose}:{user_id}"},
    )


async def invalidate_tokens_beyond(
    session: AsyncSession, user_id: uuid.UUID, purpose: str, *, keep: int
) -> int:
    """Invalidate the user's usable tokens for ``purpose`` beyond the newest ``keep``."""
    stale = (
        select(UserToken.id)
        .where(UserToken.user_id == user_id, _token_usable(purpose))
        .order_by(UserToken.created_at.desc(), UserToken.id.desc())
        .offset(keep)
    )
    result = await session.execute(
        update(UserToken)
        .where(UserToken.id.in_(stale))
        .values(invalidated_at=func.now())
        .returning(UserToken.id)
    )
    return len(result.all())


async def insert_token(
    session: AsyncSession, *, user_id: uuid.UUID, purpose: str, token_hash: bytes, ttl_seconds: int
) -> None:
    await session.execute(
        insert(UserToken).values(
            user_id=user_id,
            purpose=purpose,
            token_hash=token_hash,
            expires_at=func.now() + func.make_interval(0, 0, 0, 0, 0, 0, ttl_seconds),
        )
    )
