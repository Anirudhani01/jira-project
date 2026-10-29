"""M8: comments & activity timeline (plan M8, R3.3 row 17, R4, R7-M8). Reuses the M6/M7
``Ctx`` fixture and helpers; database-level assertions run as the restricted runtime role
unless they need the superuser (fixture setup, raw inspection)."""

import asyncio
import json
import uuid
from contextlib import AsyncExitStack
from typing import Any

import httpx
import pytest

from tests.integration.auth_support import csrf, superuser_sql
from tests.integration.tenancy_support import affected, make_tenant, rows
from tests.integration.test_issues import Ctx, new_issue, project_role
from tests.integration.test_projects import create_project, org_member, send

# Loads the ``ctx``/``_clean_rate_limits`` fixtures from test_issues without binding their
# names at module level (which would shadow every ``ctx: Ctx`` parameter -- see M7's
# test_issues_hierarchy.py for the same trick and why).
pytest_plugins = ["tests.integration.test_issues"]


async def new_comment(
    http: httpx.AsyncClient,
    slug: str,
    issue_key: str,
    body: dict[str, Any] | None = None,
    key: str | None = None,
) -> httpx.Response:
    headers = {"X-CSRF-Token": await csrf(http)}
    if key:
        headers["Idempotency-Key"] = key
    return await http.post(
        f"/api/v1/orgs/{slug}/issues/{issue_key}/comments",
        json=body if body is not None else {"body": "Looks good to me."},
        headers=headers,
    )


async def list_comments(
    http: httpx.AsyncClient, slug: str, issue_key: str, **params: str
) -> httpx.Response:
    query = ("?" + "&".join(f"{k}={v}" for k, v in params.items())) if params else ""
    return await http.get(f"/api/v1/orgs/{slug}/issues/{issue_key}/comments{query}")


async def set_project_role(ctx: Ctx, user_id: uuid.UUID, role: str) -> httpx.Response:
    return await send(
        ctx.http, "PATCH", f"/api/v1/orgs/{ctx.slug}/projects/WEB/members/{user_id}", {"role": role}
    )


async def remove_from_project(ctx: Ctx, user_id: uuid.UUID) -> httpx.Response:
    return await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/projects/WEB/members/{user_id}")


async def comment_row(comment_id: str) -> Any:
    found = await superuser_sql("SELECT * FROM comments WHERE id = :i", i=comment_id)
    return found[0] if found else None


async def comments_for_issue(org_id: uuid.UUID, issue_key: str) -> list[Any]:
    project_key, seq = issue_key.split("-")
    return await superuser_sql(
        "SELECT c.id FROM comments c JOIN issues i ON i.id = c.issue_id "
        "JOIN projects p ON p.id = i.project_id "
        "WHERE p.org_id = :o AND p.key = :k AND i.seq = :s",
        o=org_id,
        k=project_key,
        s=int(seq),
    )


@pytest.fixture
async def issue(ctx: Ctx) -> str:
    created = await new_issue(ctx.http, ctx)
    assert created.status_code == 201, created.text
    return str(created.json()["key"])


# ----------------------------------------------------------------- create, list, render
async def test_create_and_list_render_markdown_without_raw_html(ctx: Ctx, issue: str) -> None:
    created = await new_comment(
        ctx.http, ctx.slug, issue, {"body": "**bold** and a [link](https://example.com)."}
    )
    assert created.status_code == 201, created.text
    comment = created.json()
    assert comment["issue_key"] == issue
    assert comment["author"]["id"] == str(ctx.tenant.user_id)
    assert comment["body"] == "**bold** and a [link](https://example.com)."
    assert "<strong>bold</strong>" in comment["body_html"]
    assert '<a href="https://example.com"' in comment["body_html"]
    assert comment["edited_at"] is None

    listed = await list_comments(ctx.http, ctx.slug, issue)
    assert listed.status_code == 200
    assert [c["id"] for c in listed.json()["items"]] == [comment["id"]]
    assert listed.json()["next_cursor"] is None


async def test_server_owned_fields_are_rejected(ctx: Ctx, issue: str) -> None:
    for extra in (
        {"id": str(uuid.uuid4())},
        {"org_id": str(uuid.uuid4())},
        {"issue_id": str(uuid.uuid4())},
        {"author_id": str(ctx.tenant.user_id)},
        {"edited_at": "2026-01-01T00:00:00Z"},
        {"created_at": "2026-01-01T00:00:00Z"},
        {"deleted_at": "2026-01-01T00:00:00Z"},
    ):
        response = await new_comment(ctx.http, ctx.slug, issue, {"body": "x", **extra})
        assert response.status_code == 422, extra
    created = await new_comment(ctx.http, ctx.slug, issue, {"body": "Original body"})
    assert created.status_code == 201
    comment_id = created.json()["id"]
    for extra in (
        {"id": str(uuid.uuid4())},
        {"author_id": str(uuid.uuid4())},
        {"created_at": "2026-01-01T00:00:00Z"},
    ):
        response = await send(
            ctx.http,
            "PATCH",
            f"/api/v1/orgs/{ctx.slug}/comments/{comment_id}",
            {"body": "x", **extra},
        )
        assert response.status_code == 422, extra
    row = await comment_row(comment_id)
    assert row.body == "Original body"


# -------------------------------------------------------------------- idempotent create
async def test_idempotent_create_replays_and_binds_key_to_request(ctx: Ctx, issue: str) -> None:
    first = await new_comment(ctx.http, ctx.slug, issue, key="retry-1")
    again = await new_comment(ctx.http, ctx.slug, issue, key="retry-1")
    assert first.status_code == again.status_code == 201
    assert again.json() == first.json()
    reused = await new_comment(ctx.http, ctx.slug, issue, {"body": "Different body"}, key="retry-1")
    assert reused.status_code == 422
    assert reused.json()["code"] == "idempotency_key_reused"

    colleague, _ = await project_role(ctx, "member")
    theirs = await new_comment(colleague, ctx.slug, issue, key="retry-1")
    assert theirs.status_code == 201  # same key, different user: independent
    assert len(await comments_for_issue(ctx.tenant.org_id, issue)) == 2
    assert (await new_comment(ctx.http, ctx.slug, issue, key="bad key!")).status_code == 422


async def test_concurrent_identical_idempotent_creates_make_one_comment(
    ctx: Ctx, issue: str
) -> None:
    responses = await asyncio.gather(
        *(new_comment(ctx.http, ctx.slug, issue, key="race") for _ in range(4))
    )
    assert {r.status_code for r in responses} == {201}
    assert len({json.dumps(r.json(), sort_keys=True) for r in responses}) == 1


async def test_replay_after_access_is_revoked_discloses_nothing(ctx: Ctx, issue: str) -> None:
    member, member_id = await project_role(ctx, "member")
    assert (await new_comment(member, ctx.slug, issue, key="k1")).status_code == 201
    await remove_from_project(ctx, member_id)
    replay = await new_comment(member, ctx.slug, issue, key="k1")
    assert replay.status_code == 404
    assert replay.json()["code"] == "not_found"


# ------------------------------------------------------------- author / permission rules
async def test_viewer_can_read_but_not_create(ctx: Ctx, issue: str) -> None:
    viewer, _ = await project_role(ctx, "viewer")
    assert (await list_comments(viewer, ctx.slug, issue)).status_code == 200
    forbidden = await new_comment(viewer, ctx.slug, issue)
    assert forbidden.status_code == 403


async def test_author_can_edit_own_comment_but_not_someone_elses(ctx: Ctx, issue: str) -> None:
    member, _ = await project_role(ctx, "member")
    mine = (await new_comment(member, ctx.slug, issue, {"body": "First draft"})).json()
    theirs = (await new_comment(ctx.http, ctx.slug, issue, {"body": "Owner's comment"})).json()

    edited = await send(
        member, "PATCH", f"/api/v1/orgs/{ctx.slug}/comments/{mine['id']}", {"body": "Edited draft"}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["body"] == "Edited draft"
    assert edited.json()["edited_at"] is not None

    not_author = await send(
        member, "PATCH", f"/api/v1/orgs/{ctx.slug}/comments/{theirs['id']}", {"body": "Hijacked"}
    )
    assert not_author.status_code == 403
    row = await comment_row(theirs["id"])
    assert row.body == "Owner's comment"


async def test_author_may_delete_own_comment_while_a_non_viewer(ctx: Ctx, issue: str) -> None:
    member, _ = await project_role(ctx, "member")
    mine = (await new_comment(member, ctx.slug, issue, {"body": "Delete me"})).json()
    deleted = await send(member, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{mine['id']}")
    assert deleted.status_code == 204
    assert (await list_comments(ctx.http, ctx.slug, issue)).json()["items"] == []
    row = await comment_row(mine["id"])
    assert row.deleted_at is not None
    assert row.body == "Delete me"  # soft delete: row and body persist, just hidden


async def test_viewer_cannot_delete_their_own_old_comment(ctx: Ctx, issue: str) -> None:
    """Authored while a member, then demoted to viewer: the business rule is 'currently
    holds a non-viewer role', not 'held one at authorship time'."""
    member, member_id = await project_role(ctx, "member")
    mine = (await new_comment(member, ctx.slug, issue, {"body": "Written as a member"})).json()
    assert (await set_project_role(ctx, member_id, "viewer")).status_code == 204
    blocked = await send(member, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{mine['id']}")
    assert blocked.status_code == 403
    row = await comment_row(mine["id"])
    assert row.deleted_at is None
    # Editing is blocked too, by the same rule.
    blocked_edit = await send(
        member, "PATCH", f"/api/v1/orgs/{ctx.slug}/comments/{mine['id']}", {"body": "x"}
    )
    assert blocked_edit.status_code == 403


async def test_removed_member_cannot_delete_through_the_author_path(ctx: Ctx, issue: str) -> None:
    member, member_id = await project_role(ctx, "member")
    mine = (await new_comment(member, ctx.slug, issue, {"body": "Written before removal"})).json()
    assert (await remove_from_project(ctx, member_id)).status_code == 204
    blocked = await send(member, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{mine['id']}")
    assert blocked.status_code in (403, 404)  # removed outright: may not even resolve the project
    row = await comment_row(mine["id"])
    assert row.deleted_at is None


async def test_project_admin_and_org_owner_may_delete_any_comment(ctx: Ctx, issue: str) -> None:
    member, _ = await project_role(ctx, "member")
    admin, _ = await project_role(ctx, "admin")
    theirs = (await new_comment(member, ctx.slug, issue, {"body": "By a member"})).json()

    by_admin = await send(admin, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{theirs['id']}")
    assert by_admin.status_code == 204
    row = await comment_row(theirs["id"])
    assert row.deleted_at is not None

    again = (await new_comment(member, ctx.slug, issue, {"body": "By a member, again"})).json()
    by_owner = await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{again['id']}")
    assert by_owner.status_code == 204  # org owner: implicit project admin


async def test_project_member_cannot_delete_someone_elses_comment(ctx: Ctx, issue: str) -> None:
    member, _ = await project_role(ctx, "member")
    theirs = (await new_comment(ctx.http, ctx.slug, issue, {"body": "By the owner"})).json()
    blocked = await send(member, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{theirs['id']}")
    assert blocked.status_code == 403
    row = await comment_row(theirs["id"])
    assert row.deleted_at is None


# ---------------------------------------------------------------------------- RLS
async def test_rls_blocks_direct_writes_from_a_demoted_or_removed_author(
    ctx: Ctx, issue: str, rw_engine: Any
) -> None:
    """Even if the application forgot the check, the database backstop (``comments_update``)
    still blocks it: the RLS policy encodes the same rule as the service layer, not just a
    coarse "is this table writable at all"."""
    member, member_id = await project_role(ctx, "member")
    mine = (await new_comment(member, ctx.slug, issue, {"body": "Mine"})).json()
    org = ctx.tenant.org_id

    assert (await set_project_role(ctx, member_id, "viewer")).status_code == 204
    demoted = await affected(
        rw_engine,
        "UPDATE comments SET deleted_at = now() WHERE id = :i",
        org_id=org,
        user_id=member_id,
        i=mine["id"],
    )
    assert demoted == 0

    _, outsider_id = await org_member(ctx.stack, ctx.tenant)  # never had a project role
    removed = await affected(
        rw_engine,
        "UPDATE comments SET deleted_at = now() WHERE id = :i",
        org_id=org,
        user_id=outsider_id,
        i=mine["id"],
    )
    assert removed == 0

    _admin, admin_id = await project_role(ctx, "admin")
    allowed = await affected(
        rw_engine,
        "UPDATE comments SET deleted_at = now() WHERE id = :i",
        org_id=org,
        user_id=admin_id,
        i=mine["id"],
    )
    assert allowed == 1


async def test_rls_hides_comments_of_projects_the_caller_cannot_view(
    ctx: Ctx, issue: str, rw_engine: Any
) -> None:
    created = (await new_comment(ctx.http, ctx.slug, issue)).json()
    _, outsider_id = await org_member(ctx.stack, ctx.tenant)  # no project role
    _, viewer_id = await project_role(ctx, "viewer")
    org = ctx.tenant.org_id
    assert await rows(rw_engine, "SELECT id FROM comments", org_id=org, user_id=outsider_id) == []
    visible = await rows(rw_engine, "SELECT id FROM comments", org_id=org, user_id=viewer_id)
    assert [str(r.id) for r in visible] == [created["id"]]


async def test_org_membership_alone_grants_no_access_to_project_comments(
    ctx: Ctx, issue: str
) -> None:
    created = await new_comment(ctx.http, ctx.slug, issue)
    assert created.status_code == 201
    outsider, _ = await org_member(ctx.stack, ctx.tenant)  # org member, no project role
    unknown = await list_comments(outsider, ctx.slug, "NOPE-1")
    missing = await list_comments(outsider, ctx.slug, "WEB-99")
    assert unknown.status_code == missing.status_code == 404
    same_issue = await list_comments(outsider, ctx.slug, issue)
    assert same_issue.status_code == 404  # no project role at all: same as unknown
    create_blocked = await new_comment(outsider, ctx.slug, issue)
    assert create_blocked.status_code == 404
    patch_blocked = await send(
        outsider, "PATCH", f"/api/v1/orgs/{ctx.slug}/comments/{created.json()['id']}", {"body": "x"}
    )
    assert patch_blocked.status_code == 404
    delete_blocked = await send(
        outsider, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{created.json()['id']}"
    )
    assert delete_blocked.status_code == 404


async def test_cross_tenant_comment_id_is_invisible(ctx: Ctx, issue: str) -> None:
    mine = (await new_comment(ctx.http, ctx.slug, issue)).json()
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
        assert (await create_project(other.http, other.slug, key="OTH")).status_code == 201
        cross = await send(
            other.http, "PATCH", f"/api/v1/orgs/{other.slug}/comments/{mine['id']}", {"body": "x"}
        )
        assert cross.status_code == 404


# ----------------------------------------------------------------- soft delete visibility
async def test_soft_deleted_comment_body_is_never_exposed(ctx: Ctx, issue: str) -> None:
    comment = (await new_comment(ctx.http, ctx.slug, issue, {"body": "Secret-ish content"})).json()
    assert (
        await send(ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{comment['id']}")
    ).status_code == 204
    listed = await list_comments(ctx.http, ctx.slug, issue)
    assert listed.json()["items"] == []
    assert "Secret-ish" not in listed.text
    # The route resolves by id directly: it answers the uniform not_found, not the body.
    patch_after_delete = await send(
        ctx.http, "PATCH", f"/api/v1/orgs/{ctx.slug}/comments/{comment['id']}", {"body": "x"}
    )
    assert patch_after_delete.status_code == 404
    delete_again = await send(
        ctx.http, "DELETE", f"/api/v1/orgs/{ctx.slug}/comments/{comment['id']}"
    )
    assert delete_again.status_code == 404


# ------------------------------------------------------------------------- XSS / Markdown
@pytest.mark.parametrize(
    "payload",
    [
        "<script>alert(1)</script>",
        "<img src=x onerror=alert(1)>",
        "[click](javascript:alert(1))",
        "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
        '<a href="javascript:alert(1)">x</a>',
        "<iframe src=//evil.example></iframe>",
        "<svg onload=alert(1)>",
    ],
)
async def test_xss_payloads_render_inert(ctx: Ctx, issue: str, payload: str) -> None:
    created = await new_comment(ctx.http, ctx.slug, issue, {"body": payload})
    assert created.status_code == 201, created.text
    html = created.json()["body_html"]
    assert "<script" not in html
    assert "onerror" not in html
    assert "onload" not in html
    assert "javascript:" not in html
    assert "data:" not in html
    assert "<iframe" not in html
    # The raw body is returned unmodified (never itself rendered/trusted as HTML).
    assert created.json()["body"] == payload

    listed = await list_comments(ctx.http, ctx.slug, issue)
    [item] = [c for c in listed.json()["items"] if c["id"] == created.json()["id"]]
    assert item["body_html"] == html


async def test_safe_markdown_subset_renders_as_expected(ctx: Ctx, issue: str) -> None:
    body = "# Heading\n\n- one\n- two\n\n> quoted\n\n`inline code`\n\n```\nblock code\n```"
    created = await new_comment(ctx.http, ctx.slug, issue, {"body": body})
    html = created.json()["body_html"]
    assert "<h1>Heading</h1>" in html
    assert "<li>one</li>" in html
    assert "<blockquote>" in html
    assert "<code>inline code</code>" in html
    assert "<pre>" in html


# ------------------------------------------------------- deterministic timeline ordering
async def test_pagination_is_deterministic_under_equal_timestamps(ctx: Ctx, issue: str) -> None:
    await superuser_sql(
        "INSERT INTO comments (id, org_id, issue_id, author_id, body, created_at, updated_at) "
        "SELECT gen_random_uuid(), :o, (SELECT i.id FROM issues i JOIN projects p ON "
        "p.id = i.project_id WHERE p.org_id = :o AND p.key = 'WEB' AND i.seq = :s), :u, "
        "'Comment ' || g, now(), now() FROM generate_series(1, 7) AS g",
        o=ctx.tenant.org_id,
        s=int(issue.split("-")[1]),
        u=ctx.tenant.user_id,
    )
    seen: list[str] = []
    cursor: str | None = None
    for _ in range(10):
        response = await list_comments(
            ctx.http, ctx.slug, issue, limit="3", **({"cursor": cursor} if cursor else {})
        )
        assert response.status_code == 200, response.text
        page = response.json()
        seen += [c["id"] for c in page["items"]]
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(seen) == len(set(seen)) == 7  # no duplicates, no omissions
