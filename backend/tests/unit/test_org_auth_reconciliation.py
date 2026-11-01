"""Unit tests for org auth reconciliation worker settings and error isolation."""

import asyncio
from collections.abc import Awaitable
from unittest.mock import AsyncMock

import pytest

from app.worker import org_auth_reconciliation as module
from tests.conftest import make_settings


def test_org_auth_reconciliation_configuration_defaults() -> None:
    settings = make_settings()
    assert settings.org_auth_reconciliation_interval_seconds == 300
    assert settings.org_auth_reconciliation_batch_size == 100


def test_org_auth_reconciliation_configuration_overrides() -> None:
    settings = make_settings(
        org_auth_reconciliation_interval_seconds=120,
        org_auth_reconciliation_batch_size=42,
    )
    assert settings.org_auth_reconciliation_interval_seconds == 120
    assert settings.org_auth_reconciliation_batch_size == 42


async def test_reconciliation_loop_continues_after_database_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = 0
    stopping = asyncio.Event()

    async def boom(_engine: object, *, batch: int = 100) -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("simulated database outage")
        stopping.set()
        return 0

    monkeypatch.setattr(module, "run_org_auth_reconciliation", boom)
    real_wait_for = asyncio.wait_for

    async def fast_interval_wait(
        awaitable: Awaitable[object],
        *,
        timeout: float | None = None,  # noqa: ASYNC109
    ) -> object:
        if timeout == 30:
            try:
                return await real_wait_for(awaitable, timeout=0)
            except TimeoutError:
                raise TimeoutError from None
        return await real_wait_for(awaitable, timeout=timeout)

    monkeypatch.setattr(asyncio, "wait_for", fast_interval_wait)
    settings = make_settings(org_auth_reconciliation_interval_seconds=30)
    task = asyncio.create_task(module.org_auth_reconciliation_loop(settings, AsyncMock(), stopping))
    await real_wait_for(task, timeout=2)
    assert calls >= 2


async def test_stopping_interrupts_the_reconciliation_interval_wait(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``worker.stopping`` must wake the loop without waiting the full 300s interval."""
    entered_interval_wait = asyncio.Event()
    real_wait_for = asyncio.wait_for

    async def track_wait(
        awaitable: Awaitable[object],
        *,
        timeout: float | None = None,  # noqa: ASYNC109
    ) -> object:
        if timeout == 300:
            entered_interval_wait.set()
        return await real_wait_for(awaitable, timeout=timeout)

    monkeypatch.setattr(asyncio, "wait_for", track_wait)

    async def noop(_engine: object, *, batch: int = 100) -> int:
        return 0

    monkeypatch.setattr(module, "run_org_auth_reconciliation", noop)
    stopping = asyncio.Event()
    settings = make_settings(org_auth_reconciliation_interval_seconds=300)
    task = asyncio.create_task(module.org_auth_reconciliation_loop(settings, AsyncMock(), stopping))
    await real_wait_for(entered_interval_wait.wait(), timeout=2)
    started = asyncio.get_running_loop().time()
    stopping.set()
    await real_wait_for(task, timeout=2)
    assert asyncio.get_running_loop().time() - started < 1.0
