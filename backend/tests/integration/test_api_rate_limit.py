"""M12: global per-user API rate limit (plan §4.5), with a config switch to turn it off."""

from tests.integration.auth_support import auth_client
from tests.integration.tenancy_support import verified_user


async def test_a_user_over_the_budget_gets_429_with_retry_after() -> None:
    async with auth_client(api_rate_limit_per_minute=5) as http:
        await verified_user(http)
        statuses = [(await http.get("/api/v1/orgs")).status_code for _ in range(8)]
        assert statuses[:3] == [200, 200, 200]
        assert 429 in statuses
        blocked = await http.get("/api/v1/orgs")
        assert blocked.status_code == 429
        assert blocked.json()["code"] == "rate_limited"
        assert int(blocked.headers["Retry-After"]) >= 1


async def test_the_budget_is_per_user() -> None:
    async with (
        auth_client(api_rate_limit_per_minute=4) as first,
        auth_client(api_rate_limit_per_minute=4) as second,
    ):
        await verified_user(first)
        await verified_user(second)
        for _ in range(6):
            await first.get("/api/v1/orgs")
        assert (await first.get("/api/v1/orgs")).status_code == 429
        assert (await second.get("/api/v1/orgs")).status_code == 200


async def test_zero_disables_the_limit() -> None:
    async with auth_client(api_rate_limit_per_minute=0) as http:
        await verified_user(http)
        assert {(await http.get("/api/v1/orgs")).status_code for _ in range(15)} == {200}
