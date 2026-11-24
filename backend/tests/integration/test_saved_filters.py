"""Saved issue-list filters: private per user and project, validated, bounded."""

import uuid
from typing import Any

import httpx
import pytest

from app.modules.saved_filters.service import MAX_FILTERS
from tests.integration.test_issues import Ctx, project_role
from tests.integration.test_projects import send

pytest_plugins = ["tests.integration.test_issues"]


def url(ctx: Ctx, suffix: str = "") -> str:
    return f"/api/v1/orgs/{ctx.slug}/projects/WEB/saved-filters{suffix}"


async def save(
    ctx: Ctx,
    name: str = "Open bugs",
    http: httpx.AsyncClient | None = None,
    **params: str,
) -> httpx.Response:
    return await send(
        http or ctx.http, "POST", url(ctx), {"name": name, "params": params or {"type": "bug"}}
    )


async def test_create_list_rename_replace_and_delete(ctx: Ctx) -> None:
    created = await save(ctx, "Open bugs", status_category="todo", sort="priority")
    assert created.status_code == 201, created.text
    saved = created.json()
    assert saved["name"] == "Open bugs"
    assert saved["params"] == {"status_category": "todo", "sort": "priority"}

    listed = await ctx.http.get(url(ctx))
    assert listed.status_code == 200
    assert [f["id"] for f in listed.json()["items"]] == [saved["id"]]

    renamed = await send(ctx.http, "PATCH", url(ctx, f"/{saved['id']}"), {"name": "  Bugs  "})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Bugs"
    assert renamed.json()["params"] == saved["params"]

    replaced = await send(
        ctx.http, "PATCH", url(ctx, f"/{saved['id']}"), {"params": {"q": "login"}}
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["params"] == {"q": "login"}

    assert (await send(ctx.http, "DELETE", url(ctx, f"/{saved['id']}"))).status_code == 204
    assert (await ctx.http.get(url(ctx))).json()["items"] == []
    assert (await send(ctx.http, "DELETE", url(ctx, f"/{saved['id']}"))).status_code == 404


async def test_filters_are_private_to_their_owner(ctx: Ctx) -> None:
    mine = (await save(ctx, "Mine")).json()
    other, _ = await project_role(ctx, "member")
    theirs = await save(ctx, "Mine", http=other)  # the same name is fine for another user
    assert theirs.status_code == 201, theirs.text

    items = (await other.get(url(ctx))).json()["items"]
    assert [f["id"] for f in items] == [theirs.json()["id"]]
    # Another user's filter looks exactly like one that does not exist.
    assert (
        await send(other, "PATCH", url(ctx, f"/{mine['id']}"), {"name": "x"})
    ).status_code == 404
    assert (await send(other, "DELETE", url(ctx, f"/{mine['id']}"))).status_code == 404
    assert (await send(ctx.http, "DELETE", url(ctx, f"/{mine['id']}"))).status_code == 204


async def test_a_project_viewer_can_save_filters_for_themselves(ctx: Ctx) -> None:
    viewer, _ = await project_role(ctx, "viewer")
    assert (await save(ctx, "Read only", http=viewer)).status_code == 201


async def test_names_are_unique_per_user_ignoring_case(ctx: Ctx) -> None:
    assert (await save(ctx, "Bugs")).status_code == 201
    clash = await save(ctx, "bUGS")
    assert clash.status_code == 409
    assert clash.json()["code"] == "saved_filter_name_taken"

    other = (await save(ctx, "Other", type="task")).json()
    rename = await send(ctx.http, "PATCH", url(ctx, f"/{other['id']}"), {"name": "BUGS"})
    assert rename.status_code == 409
    assert rename.json()["code"] == "saved_filter_name_taken"


@pytest.mark.parametrize(
    "body",
    [
        {"name": "", "params": {"type": "bug"}},
        {"name": " ", "params": {"type": "bug"}},
        {"name": "x" * 61, "params": {"type": "bug"}},
        {"name": "No filters", "params": {}},
        {"name": "Unknown key", "params": {"project": "WEB"}},
        {"name": "Not a string", "params": {"type": 5}},
        {"name": "Too long", "params": {"q": "x" * 201}},
        {"name": "Extra", "params": {"type": "bug"}, "owner": "x"},
        {"params": {"type": "bug"}},
    ],
)
async def test_invalid_bodies_are_rejected(ctx: Ctx, body: dict[str, Any]) -> None:
    response = await send(ctx.http, "POST", url(ctx), body)
    assert response.status_code == 422, response.text


async def test_an_update_needs_something_to_change(ctx: Ctx) -> None:
    saved = (await save(ctx)).json()
    assert (await send(ctx.http, "PATCH", url(ctx, f"/{saved['id']}"), {})).status_code == 422
    empty = await send(ctx.http, "PATCH", url(ctx, f"/{saved['id']}"), {"params": {}})
    assert empty.status_code == 422
    missing = await send(ctx.http, "PATCH", url(ctx, f"/{uuid.uuid4()}"), {"name": "x"})
    assert missing.status_code == 404


async def test_the_number_of_filters_per_project_is_capped(ctx: Ctx) -> None:
    for number in range(MAX_FILTERS):
        assert (await save(ctx, f"Filter {number}", q=str(number))).status_code == 201
    over = await save(ctx, "One too many")
    assert over.status_code == 409
    assert over.json()["code"] == "saved_filter_limit"


async def test_writes_need_the_csrf_token(ctx: Ctx) -> None:
    response = await ctx.http.post(url(ctx), json={"name": "x", "params": {"type": "bug"}})
    assert response.status_code == 403
