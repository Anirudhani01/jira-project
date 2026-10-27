"""Every API route carries the right guards (plan §4.1 CSRF, §4.2 route tagging)."""

from collections.abc import Callable, Iterator
from typing import Any

from fastapi import FastAPI
from fastapi.dependencies.models import Dependant
from fastapi.routing import APIRoute

from app.modules.identity.deps import require_csrf, require_same_origin, require_session
from app.modules.identity.router import PUBLIC_ROUTES

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def _calls(dependant: Dependant) -> Iterator[Callable[..., Any]]:
    for dep in dependant.dependencies:
        if dep.call is not None:
            yield dep.call
        yield from _calls(dep)


def _api_routes(app: FastAPI) -> list[APIRoute]:
    return [r for r in app.routes if isinstance(r, APIRoute) and r.path.startswith("/api/")]


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
        and (r.path not in PUBLIC_ROUTES or r.path == "/api/v1/auth/logout")
        and require_csrf not in set(_calls(r.dependant))
    ]
    assert missing == []
