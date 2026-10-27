"""Identity HTTP API (M1). All routes are under /api/v1."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response, status

from app.core.errors import AppError
from app.modules.identity import service
from app.modules.identity.deps import (
    AuthContext,
    CsrfProtected,
    CurrentSession,
    SameOrigin,
    Services,
    clear_session_cookie,
    client_info,
    optional_session,
    set_session_cookie,
)
from app.modules.identity.models import User
from app.modules.identity.schemas import (
    AcceptedResponse,
    ChangePasswordRequest,
    LoginRequest,
    SessionInfo,
    SessionListItem,
    SessionListResponse,
    SessionStateResponse,
    SignupRequest,
    UpdateProfileRequest,
    UserResponse,
)

router = APIRouter(prefix="/api/v1", tags=["identity"])

# Routes reachable without a session. Everything else requires one (enforced by test).
PUBLIC_ROUTES = frozenset({"/api/v1/auth/signup", "/api/v1/auth/login", "/api/v1/auth/logout"})


@router.post(
    "/auth/signup",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AcceptedResponse,
    dependencies=[SameOrigin],
)
async def signup(body: SignupRequest, request: Request, services: Services) -> AcceptedResponse:
    """Always 202 without a session, whether or not the email is already registered."""
    if not services.settings.signup_is_enabled:
        raise AppError(404, "not_found")
    await service.signup(
        services,
        email=body.email,
        password=body.password,
        display_name=body.display_name,
        client=client_info(request),
    )
    return AcceptedResponse()


@router.post("/auth/login", status_code=status.HTTP_204_NO_CONTENT, dependencies=[SameOrigin])
async def login(body: LoginRequest, request: Request, services: Services) -> Response:
    issued = await service.login(
        services, email=body.email, password=body.password, client=client_info(request)
    )
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    set_session_cookie(response, services.settings, issued.token)
    return response


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfProtected])
async def logout(
    request: Request,
    services: Services,
    auth: Annotated[AuthContext | None, Depends(optional_session)],
) -> Response:
    """Idempotent: revokes the current session if there is one and clears the cookie."""
    if auth is not None:
        await service.logout(services, auth, client_info(request))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, services.settings)
    return response


@router.get("/auth/session", response_model=SessionStateResponse)
async def session_state(auth: CurrentSession, services: Services) -> SessionStateResponse:
    user = await service.get_user(services, auth.user_id)
    current = next(
        (s for s in await service.list_sessions(services, auth) if s.id == auth.session_id), None
    )
    if current is None:
        raise AppError(401, "unauthenticated", "Authentication required.")
    return SessionStateResponse(
        user=_user_response(user),
        csrf_token=services.keys.csrf_token(auth.token),
        session=SessionInfo(id=current.id, expires_at=current.expires_at),
    )


@router.patch("/me", response_model=UserResponse, dependencies=[CsrfProtected])
async def update_me(
    body: UpdateProfileRequest, auth: CurrentSession, services: Services
) -> UserResponse:
    user = await service.update_profile(services, auth, display_name=body.display_name)
    return _user_response(user)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfProtected])
async def change_password(
    body: ChangePasswordRequest, request: Request, auth: CurrentSession, services: Services
) -> Response:
    """Rotates the current session (new cookie) and revokes all other sessions."""
    issued = await service.change_password(
        services,
        auth,
        current_password=body.current_password,
        new_password=body.new_password,
        client=client_info(request),
    )
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    set_session_cookie(response, services.settings, issued.token)
    return response


@router.get("/me/sessions", response_model=SessionListResponse)
async def list_my_sessions(auth: CurrentSession, services: Services) -> SessionListResponse:
    sessions = await service.list_sessions(services, auth)
    return SessionListResponse(
        items=[
            SessionListItem(
                id=s.id,
                created_at=s.created_at,
                last_seen_at=s.last_seen_at,
                expires_at=s.expires_at,
                ip=str(s.ip) if s.ip is not None else None,
                user_agent=s.user_agent,
                current=s.id == auth.session_id,
            )
            for s in sessions
        ]
    )


@router.delete(
    "/me/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def revoke_my_session(
    session_id: uuid.UUID, request: Request, auth: CurrentSession, services: Services
) -> Response:
    await service.revoke_one(services, auth, session_id, client_info(request))
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    if session_id == auth.session_id:
        clear_session_cookie(response, services.settings)
    return response


@router.post(
    "/me/sessions/revoke-others",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def revoke_other_sessions(
    request: Request, auth: CurrentSession, services: Services
) -> Response:
    await service.revoke_others(services, auth, client_info(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def _user_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        display_name=user.display_name,
        email_verified=user.email_verified_at is not None,
    )
