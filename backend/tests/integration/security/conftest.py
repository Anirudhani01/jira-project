"""Shared fixtures for the cross-tenant security suite (plan R3.5)."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import pytest

from tests.integration.auth_support import flush_test_redis
from tests.integration.tenancy_support import Tenant, make_tenant


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def two_tenants() -> AsyncIterator[tuple[Tenant, Tenant]]:
    async with AsyncExitStack() as stack:
        a = await make_tenant(stack, "alpha")
        await flush_test_redis()  # each tenant signs up from the same test IP
        b = await make_tenant(stack, "bravo")
        yield a, b
