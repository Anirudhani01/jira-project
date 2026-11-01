"""A4b.2: workflow mutation vs concurrent writers and issue lifecycle."""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import httpx
import pytest

from tests.integration.auth_support import superuser_sql
from tests.integration.test_issues import Ctx, new_issue
from tests.integration.test_issues_hierarchy import transition, transitions_of, workflow_id_of
from tests.integration.test_workflow_edit import (
    _body_from_workflow,
    _get_workflow,
    _put_workflow,
    _workflow_without_status,
)

pytest_plugins = ["tests.integration.test_issues"]


@pytest.fixture
async def project_ctx(ctx: Ctx) -> Ctx:
    return ctx


async def test_two_put_writers_second_gets_revision_conflict(project_ctx: Ctx) -> None:
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    body_a = _body_from_workflow(wf, name="Writer A")
    body_b = _body_from_workflow(wf, name="Writer B")

    async def put(client: httpx.AsyncClient, body: dict[str, Any]) -> httpx.Response:
        return await _put_workflow(client, project_ctx.slug, body, revision=wf["revision"])

    first, second = await asyncio.gather(
        put(project_ctx.http, body_a),
        put(project_ctx.http, body_b),
    )
    codes = sorted(r.status_code for r in (first, second))
    assert codes == [200, 412]
    winners = [r for r in (first, second) if r.status_code == 200]
    assert len(winners) == 1
    assert winners[0].json()["revision"] == wf["revision"] + 1


async def test_issue_create_while_workflow_remaps_status(project_ctx: Ctx) -> None:
    """Issue create and status deletion serialize; remapped issues stay valid."""
    assert (await new_issue(project_ctx.http, project_ctx)).status_code == 201
    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    todo_id = wf["initial_status_id"]
    target = next(s for s in wf["statuses"] if s["id"] != todo_id)
    body = _workflow_without_status(wf, todo_id, remap_to=target["id"])

    async def remap() -> httpx.Response:
        return await _put_workflow(
            project_ctx.http, project_ctx.slug, body, revision=wf["revision"]
        )

    async def create() -> httpx.Response:
        return await new_issue(project_ctx.http, project_ctx, key=str(uuid.uuid4()))

    remap_result, create_result = await asyncio.gather(remap(), create())
    assert remap_result.status_code == 200
    assert create_result.status_code == 201
    refreshed = await _get_workflow(project_ctx.http, project_ctx.slug)
    status_ids = {s["id"] for s in refreshed["statuses"]}
    assert todo_id not in status_ids


async def test_transition_races_workflow_status_removal(project_ctx: Ctx) -> None:
    """Transition and workflow PUT both take the workflow parent lock; outcome stays consistent."""
    issue = (await new_issue(project_ctx.http, project_ctx)).json()
    workflow_id = await workflow_id_of(project_ctx.tenant.org_id)
    by_status = await transitions_of(workflow_id)
    in_progress = by_status["In Progress"]
    applied = await transition(
        project_ctx.http,
        project_ctx.slug,
        issue["key"],
        in_progress.id,
        '"v1"',
    )
    assert applied.status_code == 200
    issue = applied.json()
    in_progress_status_id = str(in_progress.status_id)

    wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    assert wf["revision"] >= 1
    revision_before = wf["revision"]
    remap_target = next(
        s for s in wf["statuses"] if str(s["id"]) != in_progress_status_id
    )
    body = _workflow_without_status(
        wf, in_progress_status_id, remap_to=str(remap_target["id"])
    )
    done = by_status["Done"]
    start = asyncio.Event()
    results: dict[str, httpx.Response] = {}

    async def run_transition() -> None:
        await start.wait()
        results["transition"] = await transition(
            project_ctx.http,
            project_ctx.slug,
            issue["key"],
            done.id,
            f'"v{issue["version"]}"',
        )

    async def run_workflow_put() -> None:
        await start.wait()
        results["workflow"] = await _put_workflow(
            project_ctx.http,
            project_ctx.slug,
            body,
            revision=revision_before,
        )

    transition_task = asyncio.create_task(run_transition())
    workflow_task = asyncio.create_task(run_workflow_put())
    start.set()
    await asyncio.gather(transition_task, workflow_task)

    transition_result = results["transition"]
    workflow_result = results["workflow"]
    assert transition_result.status_code in (200, 412, 422)
    assert workflow_result.status_code in (200, 412, 422)
    assert transition_result.status_code != 500
    assert workflow_result.status_code != 500

    refreshed_wf = await _get_workflow(project_ctx.http, project_ctx.slug)
    valid_status_ids = {str(s["id"]) for s in refreshed_wf["statuses"]}
    [row] = await superuser_sql(
        "SELECT status_id FROM issues WHERE org_id = :o AND id = :id",
        o=project_ctx.tenant.org_id,
        id=issue["id"],
    )
    assert str(row.status_id) in valid_status_ids

    if workflow_result.status_code == 200:
        assert refreshed_wf["revision"] == revision_before + 1
        assert in_progress_status_id not in valid_status_ids
    else:
        assert refreshed_wf["revision"] == revision_before
