"""Every API route carries the right guards (plan §4.1 CSRF, §4.2 route tagging)."""

from collections.abc import Callable, Iterator
from typing import Any

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute, iter_route_contexts

from app.authz.deps import AUTHZ_ATTRIBUTE, resolve_org
from app.modules.identity.deps import require_csrf, require_same_origin, require_session
from app.modules.identity.router import PUBLIC_ROUTES

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}
# Public routes that still act on the current session when there is one.
PUBLIC_SESSION_ROUTES = {"/api/v1/auth/logout", "/api/v1/auth/verify-email"}


def _calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    for dep in dependant.dependencies:
        if dep.call is not None:
            yield dep.call
        yield from _calls(dep)


def _api_routes(app: FastAPI) -> list[APIRoute]:
    # FastAPI >= 0.16x wraps included routers lazily: `app.routes` holds wrappers, not
    # APIRoutes. Enumerating it directly made these guards pass vacuously (zero routes).
    routes = [rc.route for rc in iter_route_contexts(app.routes)]
    return [r for r in routes if isinstance(r, APIRoute) and r.path.startswith("/api/")]


def test_route_enumeration_is_not_vacuous(app: FastAPI) -> None:
    """Regression: the guards below must actually see the API's routes."""
    paths = {r.path for r in _api_routes(app)}
    assert {"/api/v1/auth/signup", "/api/v1/me/password", "/api/v1/orgs/{org_slug}"} <= paths
    assert len(paths) >= 17


def _methods(route: APIRoute) -> set[str]:
    return set(route.methods or ())


def test_every_unsafe_route_checks_origin(app: FastAPI) -> None:
    missing = [
        f"{sorted(_methods(r))} {r.path}"
        for r in _api_routes(app)
        if _methods(r) & UNSAFE and require_same_origin not in set(_calls(r.dependant))
    ]
    assert missing == []


def test_every_non_public_route_requires_session(app: FastAPI) -> None:
    missing = [
        r.path
        for r in _api_routes(app)
        if r.path not in PUBLIC_ROUTES and require_session not in set(_calls(r.dependant))
    ]
    assert missing == []


def test_every_authenticated_unsafe_route_requires_csrf_token(app: FastAPI) -> None:
    missing = [
        f"{sorted(_methods(r))} {r.path}"
        for r in _api_routes(app)
        if _methods(r) & UNSAFE
        and (r.path not in PUBLIC_ROUTES or r.path in PUBLIC_SESSION_ROUTES)
        and require_csrf not in set(_calls(r.dependant))
    ]
    assert missing == []


# ------------------------------------------------------------------- M3: authorization
# Authenticated routes that act only on the caller's own account or memberships (no org
# context): they need a session, never an org permission.
ACCOUNT_ROUTES = {
    "/api/v1/auth/session",
    "/api/v1/me",
    "/api/v1/me/password",
    "/api/v1/me/sessions",
    "/api/v1/me/sessions/{session_id}",
    "/api/v1/me/sessions/revoke-others",
    "/api/v1/orgs",
}


def _permissions(route: APIRoute) -> list[object]:
    return [
        getattr(call, AUTHZ_ATTRIBUTE)
        for call in _calls(route.dependant)
        if hasattr(call, AUTHZ_ATTRIBUTE)
    ]


def test_every_route_is_public_account_scoped_or_permission_tagged(app: FastAPI) -> None:
    """Plan §4.2: a route without a declared policy fails CI."""
    untagged = [
        r.path
        for r in _api_routes(app)
        if r.path not in PUBLIC_ROUTES
        and r.path not in ACCOUNT_ROUTES
        and len(_permissions(r)) != 1
    ]
    assert untagged == []


def test_every_org_route_resolves_the_org_through_membership(app: FastAPI) -> None:
    org_routes = [r for r in _api_routes(app) if "{org_slug}" in r.path]
    assert org_routes
    for route in org_routes:
        assert resolve_org in set(_calls(route.dependant)), route.path
        assert len(_permissions(route)) == 1, route.path
