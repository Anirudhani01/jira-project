"""Request dependencies: identity services, session authentication, Origin and CSRF.

Every unsafe (state-changing) API route must depend on ``require_same_origin``; routes
acting on an authenticated session must also depend on ``require_csrf``. Both are
enforced for all routes by ``tests/unit/test_route_guards.py``.
"""

import ipaddress
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.errors import AppError
from app.core.rate_limit import RateLimiter
from app.core.security import SecretKeys, hash_token
from app.db.tenant import TenantContext, bind_tenant
from app.modules.identity import repository
from app.modules.identity.passwords import BreachChecker, PasswordHashing
from app.modules.security_events.service import ClientInfo

CSRF_HEADER = "X-CSRF-Token"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(slots=True)
class IdentityServices:
    settings: Settings
    sessionmaker: async_sessionmaker[AsyncSession]
    keys: SecretKeys
    hashing: PasswordHashing
    breach_checker: BreachChecker
    limiter: RateLimiter


@dataclass(frozen=True, slots=True)
class AuthContext:
    user_id: uuid.UUID
    session_id: uuid.UUID
    token: str
    email: str
    display_name: str
    email_verified: bool


def get_services(request: Request) -> IdentityServices:
    services: IdentityServices = request.app.state.identity
    return services


Services = Annotated[IdentityServices, Depends(get_services)]


def _client_ip(request: Request) -> str | None:
    """The peer address as resolved by the server (proxy headers are only honoured from
    FORWARDED_ALLOW_IPS). Anything that is not a literal IP is discarded rather than used
    as a rate-limit key or stored in an INET column."""
    host = request.client.host if request.client else None
    if not host:
        return None
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return None


def client_info(request: Request) -> ClientInfo:
    user_agent = request.headers.get("user-agent")
    return ClientInfo(ip=_client_ip(request), user_agent=user_agent[:256] if user_agent else None)


def unauthenticated() -> AppError:
    return AppError(401, "unauthenticated", "Authentication required.")


async def _load_session(services: IdentityServices, token: str) -> AuthContext | None:
    settings = services.settings
    async with services.sessionmaker() as session, session.begin():
        record = await repository.get_active_session(
            session,
            hash_token(token),
            idle_seconds=settings.session_idle_ttl_seconds,
            touch_seconds=settings.session_touch_interval_seconds,
        )
        if record is None:
            return None
        await bind_tenant(session, TenantContext(org_id=None, user_id=record.user_id))
        user = await repository.get_user_by_id(session, record.user_id)
        if user is None or user.status != "active":
            return None
        if record.needs_touch:
            await repository.touch_session(session, record.id)
        return AuthContext(
            user_id=user.id,
            session_id=record.id,
            token=token,
            email=user.email,
            display_name=user.display_name,
            email_verified=user.email_verified_at is not None,
        )


async def optional_session(request: Request, services: Services) -> AuthContext | None:
    """Validate the session cookie at request start (revocations after this point do
    not affect the in-flight request; the next request sees them)."""
    token = request.cookies.get(services.settings.session_cookie_name)
    if not token or len(token) > 128:
        return None
    return await _load_session(services, token)


async def require_session(
    auth: Annotated[AuthContext | None, Depends(optional_session)],
) -> AuthContext:
    if auth is None:
        raise unauthenticated()
    return auth


def require_same_origin(request: Request, services: Services) -> None:
    """Login-CSRF and CSRF defense: unsafe requests must come from our own origin."""
    if request.method in SAFE_METHODS:
        return
    if request.headers.get("origin") != services.settings.allowed_origin:
        raise AppError(403, "csrf_failed", "Request origin is not allowed.")


def require_csrf(
    request: Request,
    services: Services,
    auth: Annotated[AuthContext | None, Depends(optional_session)],
    _origin: Annotated[None, Depends(require_same_origin)],
) -> None:
    """Session-bound CSRF token for unsafe requests made with a session cookie."""
    if request.method in SAFE_METHODS or auth is None:
        return
    presented = request.headers.get(CSRF_HEADER, "")
    if not presented or not services.keys.csrf_matches(auth.token, presented):
        raise AppError(403, "csrf_failed", "Missing or invalid CSRF token.")


CurrentSession = Annotated[AuthContext, Depends(require_session)]
SameOrigin = Depends(require_same_origin)
CsrfProtected = Depends(require_csrf)


def set_session_cookie(response: Response, settings: Settings, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_absolute_ttl_seconds,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )


def clear_session_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        settings.session_cookie_name,
        path="/",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="lax",
    )
