"""M12: issue search (``q``): full-text on summary/description, exact key match, access."""

from typing import Any

import httpx

from tests.integration.test_issues import Ctx, new_issue
from tests.integration.test_projects import create_project, org_member

pytest_plugins = ["tests.integration.test_issues"]


async def search(http: httpx.AsyncClient, ctx: Ctx, q: str, **params: str) -> list[dict[str, Any]]:
    response = await http.get(f"/api/v1/orgs/{ctx.slug}/issues", params={"q": q, **params})
    assert response.status_code == 200, response.text
    return list(response.json()["items"])


async def make(ctx: Ctx, summary: str, description: str | None = None, project: str = "WEB") -> str:
    extra = {"description": description} if description else {}
    response = await new_issue(ctx.http, ctx, ctx.body(summary, **extra), project=project)
    assert response.status_code == 201, response.text
    return str(response.json()["key"])


async def test_text_search_matches_summary_and_description_with_stemming(ctx: Ctx) -> None:
    login = await make(ctx, "Login button misaligned")
    stem = await make(ctx, "Checkout flow", "Users report crashes on submit")
    await make(ctx, "Unrelated chore")
    assert [i["key"] for i in await search(ctx.http, ctx, "login")] == [login]
    assert [i["key"] for i in await search(ctx.http, ctx, "crash")] == [stem]  # crashes -> crash
    assert [i["key"] for i in await search(ctx.http, ctx, "checkout")] == [stem]
    assert await search(ctx.http, ctx, "nonexistentword") == []


async def test_exact_key_match_and_case_insensitivity(ctx: Ctx) -> None:
    first = await make(ctx, "Alpha")
    await make(ctx, "Beta")
    assert [i["key"] for i in await search(ctx.http, ctx, first)] == [first]
    assert [i["key"] for i in await search(ctx.http, ctx, first.lower())] == [first]
    assert await search(ctx.http, ctx, "WEB-999") == []


async def test_search_combines_with_filters_and_project_scope(ctx: Ctx) -> None:
    assert (await create_project(ctx.http, ctx.slug, key="APP")).status_code == 201
    web = await make(ctx, "Shared term in web")
    app = await make(ctx, "Shared term in app", project="APP")
    assert {i["key"] for i in await search(ctx.http, ctx, "shared")} == {web, app}
    assert [i["key"] for i in await search(ctx.http, ctx, "shared", project="APP")] == [app]


async def test_search_never_returns_issues_of_projects_the_caller_cannot_view(ctx: Ctx) -> None:
    await make(ctx, "Confidential roadmap")
    outsider, _ = await org_member(ctx.stack, ctx.tenant)  # org member, no project role
    assert await search(outsider, ctx, "confidential") == []
    assert await search(outsider, ctx, "WEB-1") == []


async def test_search_operators_and_hostile_input_are_safe(ctx: Ctx) -> None:
    await make(ctx, "Plain issue")
    for q in ("'; DROP TABLE issues; --", "a & b | !c", '"unterminated', "(((", "*:*", "\\"):
        response = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues", params={"q": q})
        assert response.status_code == 200, (q, response.text)
    too_long = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues", params={"q": "x" * 201})
    assert too_long.status_code == 422


async def test_deleted_issues_are_not_found(ctx: Ctx) -> None:
    key = await make(ctx, "Soon deleted")
    csrf = str((await ctx.http.get("/api/v1/auth/session")).json()["csrf_token"])
    deleted = await ctx.http.delete(
        f"/api/v1/orgs/{ctx.slug}/issues/{key}", headers={"X-CSRF-Token": csrf, "If-Match": '"v1"'}
    )
    assert deleted.status_code == 204, deleted.text
    assert await search(ctx.http, ctx, "deleted") == []
    assert await search(ctx.http, ctx, key) == []


async def test_search_pagination_follows_the_cursor(ctx: Ctx) -> None:
    for number in range(3):
        await make(ctx, f"Pageable item {number}")
    first = (
        await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues", params={"q": "pageable", "limit": 2})
    ).json()
    assert len(first["items"]) == 2
    second = (
        await ctx.http.get(
            f"/api/v1/orgs/{ctx.slug}/issues",
            params={"q": "pageable", "limit": 2, "cursor": first["next_cursor"]},
        )
    ).json()
    assert len(second["items"]) == 1
