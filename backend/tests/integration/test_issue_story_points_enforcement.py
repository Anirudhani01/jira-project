"""B3: issue story points governed by org/project settings."""

import uuid
from pathlib import Path

from tests.integration.auth_support import csrf, superuser_sql
from tests.integration.test_issues import Ctx, new_issue, patch
from tests.integration.test_story_points import created

pytest_plugins = ["tests.integration.test_issues"]

ORG_SETTINGS = "/api/v1/orgs/{slug}/settings"
PROJECT_SETTINGS = "/api/v1/orgs/{slug}/projects/WEB/settings"


async def set_org(ctx: Ctx, **fields: object) -> None:
    response = await ctx.http.patch(
        ORG_SETTINGS.format(slug=ctx.slug),
        json=fields,
        headers={"X-CSRF-Token": await csrf(ctx.http)},
    )
    assert response.status_code == 200, response.text


async def set_project(ctx: Ctx, **fields: object) -> None:
    response = await ctx.http.patch(
        PROJECT_SETTINGS.format(slug=ctx.slug),
        json=fields,
        headers={"X-CSRF-Token": await csrf(ctx.http)},
    )
    assert response.status_code == 200, response.text


async def story_points_in_db(issue_id: object) -> int | None:
    [row] = await superuser_sql(
        "SELECT story_points FROM issues WHERE id = :i",
        i=issue_id,
    )
    return row.story_points


async def activity_count(issue_id: object, field: str = "story_points") -> int:
    [row] = await superuser_sql(
        "SELECT count(*) AS n FROM issue_activity WHERE issue_id = :i AND field = :f",
        i=issue_id,
        f=field,
    )
    return int(row.n)


async def test_effective_project_max_rejects_create_and_patch(ctx: Ctx) -> None:
    await set_project(ctx, story_points_max_override=8)
    body = ctx.body("Sized", story_points=9)
    assert (await new_issue(ctx.http, ctx, body)).status_code == 422
    base = await created(ctx, 5)
    rejected = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 9}, '"v1"')
    assert rejected.status_code == 422
    assert rejected.json()["code"] == "story_points_exceeds_max"
    accepted = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 8}, '"v1"')
    assert accepted.status_code == 200
    assert accepted.json()["story_points"] == 8


async def test_org_disabled_blocks_new_points_preserves_history(ctx: Ctx) -> None:
    base = await created(ctx, 5)
    await set_org(ctx, story_points_enabled=False)
    assert (await new_issue(ctx.http, ctx, ctx.body("New", story_points=3))).status_code == 422
    assert (await new_issue(ctx.http, ctx, ctx.body("Fine"))).status_code == 201
    got = await ctx.http.get(f"/api/v1/orgs/{ctx.slug}/issues/{base['key']}")
    assert got.json()["story_points"] == 5
    same = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 5}, '"v1"')
    assert same.status_code == 200
    assert same.json()["version"] == 1
    cleared = await patch(ctx.http, ctx.slug, base["key"], {"story_points": None}, '"v1"')
    assert cleared.status_code == 200
    assert cleared.json()["story_points"] is None
    blocked = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 3}, '"v2"')
    assert blocked.status_code == 422
    assert blocked.json()["code"] == "story_points_disabled"


async def test_project_disabled_override_blocks_new_points(ctx: Ctx) -> None:
    await set_project(ctx, story_points_enabled_override=False)
    assert (await new_issue(ctx.http, ctx, ctx.body("X", story_points=1))).status_code == 422


async def test_settings_conflict_blocks_non_null_but_allows_clear_and_other_fields(
    ctx: Ctx,
) -> None:
    base = await created(ctx, 5)
    await set_project(ctx, story_points_max_override=50)
    await set_org(ctx, story_points_max=21)
    settings = await ctx.http.get(PROJECT_SETTINGS.format(slug=ctx.slug))
    assert settings.status_code == 409
    conflict = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 8}, '"v1"')
    assert conflict.status_code == 409
    assert conflict.json()["code"] == "project_settings_conflict"
    issue_id = uuid.UUID(base["id"])
    assert await story_points_in_db(issue_id) == 5
    assert await activity_count(issue_id) == 0
    summary = await patch(
        ctx.http, ctx.slug, base["key"], {"summary": "Still conflicted"}, '"v1"'
    )
    assert summary.status_code == 200
    cleared = await patch(ctx.http, ctx.slug, base["key"], {"story_points": None}, '"v2"')
    assert cleared.status_code == 200
    assert cleared.json()["story_points"] is None


async def test_conflict_recovery_via_corrected_value_on_issue(ctx: Ctx) -> None:
    base = await created(ctx, 5)
    await set_project(ctx, story_points_max_override=50)
    await set_org(ctx, story_points_max=21)
    assert (
        await patch(ctx.http, ctx.slug, base["key"], {"story_points": 8}, '"v1"')
    ).status_code == 409
    await set_project(ctx, story_points_max_override=8)
    fixed = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 8}, '"v1"')
    assert fixed.status_code == 200
    assert fixed.json()["story_points"] == 8


async def test_failed_patch_does_not_persist_story_points_or_activity(ctx: Ctx) -> None:
    await set_project(ctx, story_points_max_override=8)
    base = await created(ctx, 5)
    issue_id = uuid.UUID(base["id"])
    bad = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 13}, '"v1"')
    assert bad.status_code == 422
    assert await story_points_in_db(issue_id) == 5
    assert await activity_count(issue_id) == 0


async def test_changing_points_still_writes_activity_when_allowed(ctx: Ctx) -> None:
    base = await created(ctx, 3)
    changed = await patch(ctx.http, ctx.slug, base["key"], {"story_points": 8}, '"v1"')
    assert changed.status_code == 200
    [entry] = await superuser_sql(
        "SELECT old_value, new_value FROM issue_activity "
        "WHERE issue_id = :i AND field = 'story_points'",
        i=uuid.UUID(base["id"]),
    )
    assert (entry.old_value, entry.new_value) == (3, 8)


def test_issue_story_points_write_paths_are_service_gated() -> None:
    """Documented inventory: only create_issue and update_issue mutate estimates via API."""
    root = Path(__file__).resolve().parents[2] / "app" / "modules" / "issues"
    service = (root / "service.py").read_text(encoding="utf-8")
    bulk = (root / "bulk.py").read_text(encoding="utf-8")
    assert "story_points_policy" in service
    assert "story_points" not in bulk
    repository = (root / "repository.py").read_text(encoding="utf-8")
    assert repository.count("story_points=") == 1  # insert_issue only
