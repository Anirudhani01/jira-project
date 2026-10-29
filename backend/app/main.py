"""FastAPI application factory.

Run with: ``uvicorn app.main:create_app --factory --no-access-log``
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from redis.asyncio import Redis

from app.core.config import Settings, get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import (
    BodySizeLimitMiddleware,
    ErrorBoundaryMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.rate_limit import RateLimiter
from app.core.security import SecretKeys
from app.db.engine import create_db_engine
from app.db.session import create_sessionmaker
from app.health import DependencyReadinessProbe, ReadinessProbe
from app.health import router as health_router
from app.modules.boards.router import router as boards_router
from app.modules.comments.router import router as comments_router
from app.modules.identity.deps import IdentityServices
from app.modules.identity.passwords import BreachChecker, PasswordHashing
from app.modules.identity.router import router as identity_router
from app.modules.issues.router import router as issues_router
from app.modules.orgs.router import router as orgs_router
from app.modules.projects.router import router as projects_router

API_DOCS_PATH = "/api/docs"
OPENAPI_PATH = "/api/openapi.json"


def create_redis(settings: Settings) -> Redis:
    return Redis.from_url(
        settings.redis_url.get_secret_value(),
        socket_connect_timeout=settings.redis_timeout_seconds,
        socket_timeout=settings.redis_timeout_seconds,
        health_check_interval=30,
    )


def create_app(
    settings: Settings | None = None,
    *,
    readiness: ReadinessProbe | None = None,
    configure_logs: bool = True,
    breach_checker: BreachChecker | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    if configure_logs:
        configure_logging(settings.log_level)

    # Engine and Redis clients connect lazily; creating them does no I/O.
    engine = create_db_engine(settings)
    redis = create_redis(settings)
    dependency_probe = DependencyReadinessProbe(
        engine=engine,
        redis=redis,
        timeout_seconds=settings.readiness_timeout_seconds,
        enforce_role_checks=settings.enforce_db_role_checks,
    )

    sessionmaker = create_sessionmaker(engine)
    keys = SecretKeys(settings.app_secret_key)
    identity = IdentityServices(
        settings=settings,
        sessionmaker=sessionmaker,
        keys=keys,
        hashing=PasswordHashing(settings),
        breach_checker=breach_checker or BreachChecker(settings),
        limiter=RateLimiter(redis, keys, enabled=settings.rate_limit_enabled),
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        await dependency_probe.verify_role_at_startup()
        try:
            yield
        finally:
            await identity.breach_checker.aclose()
            await redis.aclose()
            await engine.dispose()

    docs_enabled = settings.api_docs_enabled
    app = FastAPI(
        title="Jira Project API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=API_DOCS_PATH if docs_enabled else None,
        redoc_url=None,
        openapi_url=OPENAPI_PATH if docs_enabled else None,
        swagger_ui_oauth2_redirect_url=None,
    )
    app.state.settings = settings
    app.state.db_engine = engine
    app.state.sessionmaker = sessionmaker
    app.state.identity = identity
    app.state.redis = redis
    app.state.readiness = readiness or dependency_probe

    register_exception_handlers(app)
    app.include_router(health_router)
    app.include_router(identity_router)
    app.include_router(orgs_router)
    app.include_router(projects_router)
    app.include_router(issues_router)
    app.include_router(boards_router)
    app.include_router(comments_router)

    # add_middleware wraps: the last added is outermost.
    app.add_middleware(ErrorBoundaryMiddleware)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    app.add_middleware(
        SecurityHeadersMiddleware,
        hsts=settings.is_production_like,
        docs_path=API_DOCS_PATH if docs_enabled else None,
    )
    app.add_middleware(RequestContextMiddleware)
    return app
