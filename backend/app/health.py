"""Liveness and readiness.

- ``/healthz``: process is alive. Never touches dependencies (avoids restart storms).
- ``/readyz``: PostgreSQL is required (503 when unreachable or the runtime role is
  unsafe in staging/prod). Redis is non-critical in the MVP (rate limiting only), so a
  Redis failure reports ``degraded`` but stays 200 to keep instances in rotation.
"""

import asyncio
import logging
from typing import Literal, Protocol

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.role_check import UnsafeDatabaseRoleError, verify_runtime_role

logger = logging.getLogger("app.health")

DatabaseState = Literal["ok", "unavailable", "misconfigured"]
RedisState = Literal["ok", "degraded"]
OverallState = Literal["ready", "degraded", "unavailable"]


class LivenessResponse(BaseModel):
    status: Literal["ok"]


class ReadinessChecks(BaseModel):
    database: DatabaseState
    redis: RedisState


class ReadinessResponse(BaseModel):
    status: OverallState
    checks: ReadinessChecks


class ReadinessProbe(Protocol):
    async def check(self) -> ReadinessResponse: ...


class DependencyReadinessProbe:
    """Checks PostgreSQL and Redis; also completes a deferred runtime-role check."""

    def __init__(
        self,
        *,
        engine: AsyncEngine,
        redis: Redis,
        timeout_seconds: float,
        enforce_role_checks: bool,
    ) -> None:
        self._engine = engine
        self._redis = redis
        self._timeout = timeout_seconds
        self._enforce = enforce_role_checks
        self._role_verified = False
        self._role_unsafe = False

    async def verify_role_at_startup(self) -> None:
        """Run the role check at startup.

        Unsafe role + enforcement -> raise (the process refuses to start). Database
        unreachable -> defer; readiness keeps retrying and stays 503 until it passes.
        """
        try:
            async with asyncio.timeout(self._timeout):
                await self._verify_role()
        except UnsafeDatabaseRoleError:
            raise
        except Exception as exc:
            logger.warning(
                "runtime role check deferred: database unreachable",
                extra={
                    "event": "db.role_check",
                    "outcome": "deferred",
                    "error_type": type(exc).__name__,
                },
            )

    async def _verify_role(self) -> None:
        violations = await verify_runtime_role(self._engine, enforce=self._enforce)
        self._role_verified = True
        self._role_unsafe = bool(violations) and self._enforce

    async def _check_database(self) -> DatabaseState:
        try:
            async with asyncio.timeout(self._timeout):
                if not self._role_verified:
                    await self._verify_role()
                async with self._engine.connect() as connection:
                    await connection.execute(text("SELECT 1"))
        except UnsafeDatabaseRoleError:
            self._role_unsafe = True
            return "misconfigured"
        except Exception as exc:
            logger.warning(
                "readiness: database unavailable",
                extra={"event": "readiness", "check": "database", "error_type": type(exc).__name__},
            )
            return "unavailable"
        return "misconfigured" if self._role_unsafe else "ok"

    async def _check_redis(self) -> RedisState:
        try:
            async with asyncio.timeout(self._timeout):
                await self._redis.ping()
        except Exception as exc:
            logger.warning(
                "readiness: redis degraded",
                extra={"event": "readiness", "check": "redis", "error_type": type(exc).__name__},
            )
            return "degraded"
        return "ok"

    async def check(self) -> ReadinessResponse:
        database, redis_state = await asyncio.gather(self._check_database(), self._check_redis())
        if database != "ok":
            status: OverallState = "unavailable"
        elif redis_state != "ok":
            status = "degraded"
        else:
            status = "ready"
        return ReadinessResponse(
            status=status, checks=ReadinessChecks(database=database, redis=redis_state)
        )


router = APIRouter(tags=["health"])


@router.get("/healthz", response_model=LivenessResponse)
async def healthz() -> LivenessResponse:
    return LivenessResponse(status="ok")


@router.get(
    "/readyz",
    response_model=ReadinessResponse,
    responses={503: {"model": ReadinessResponse, "description": "Not ready"}},
)
async def readyz(request: Request) -> JSONResponse:
    probe: ReadinessProbe = request.app.state.readiness
    result = await probe.check()
    return JSONResponse(
        result.model_dump(), status_code=503 if result.status == "unavailable" else 200
    )
