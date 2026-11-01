"""Organization story points defaults on organization_settings (B1)."""

from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import pytest

from app.modules.orgs.settings_defaults import DEFAULT_STORY_POINTS_ENABLED, DEFAULT_STORY_POINTS_MAX
from tests.integration.auth_support import flush_test_redis, superuser_sql
from tests.integration.tenancy_support import Tenant, make_tenant

SETTINGS = "/api/v1/orgs/{slug}/settings"


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


async def _story_points_for_org(org_id: object) -> tuple[bool, int]:
    [row] = await superuser_sql(
        "SELECT story_points_enabled, story_points_max FROM organization_settings "
        "WHERE org_id = :o",
        o=org_id,
    )
    return bool(row.story_points_enabled), int(row.story_points_max)


async def test_existing_org_has_story_points_defaults(tenant: Tenant) -> None:
    enabled, maximum = await _story_points_for_org(tenant.org_id)
    assert enabled == DEFAULT_STORY_POINTS_ENABLED
    assert maximum == DEFAULT_STORY_POINTS_MAX
    response = await tenant.http.get(SETTINGS.format(slug=tenant.slug))
    assert response.status_code == 200
    body = response.json()
    assert body["story_points_enabled"] is True
    assert body["story_points_max"] == 100
