"""Seed the local **jira** database with a demo org, projects, and board-friendly issues.

Requires: Postgres up (`make infra-up`), migrations applied, API reachable (e.g. `make dev` or
docker backend on :8000). Reads credentials from the repo `.env` (POSTGRES_PASSWORD, APP_BASE_URL).

Usage (from repo root):

    make seed-demo

Login after seeding:
  Email:    demo@gmail.com
  Password: Winter2026!Mob
  Org:      demo  →  SHOP kanban board, MOBILE scrum board (+ backlog items)
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

DEMO_EMAIL = "demo@gmail.com"
DEMO_PASSWORD = "Winter2026!Mob"  # noqa: S105  # gitleaks:allow local demo only (12+ chars, no "demo")
DEMO_NAME = "Demo User"
DEMO_ORG_SLUG = "demo"
DEMO_ORG_NAME = "Demo Org"
KANBAN_KEY = "SHOP"
SCRUM_KEY = "MOBILE"

API_BASE = os.environ.get("SEED_API_URL", "http://127.0.0.1:8000").rstrip("/")
ORIGIN = os.environ.get("APP_BASE_URL", "http://localhost:5173").rstrip("/")


def _superuser_url() -> str:
    port = os.environ.get("POSTGRES_HOST_PORT", "5432")
    password = os.environ["POSTGRES_PASSWORD"]
    return f"postgresql+asyncpg://postgres:{password}@127.0.0.1:{port}/jira"


async def superuser_sql(statement: str, **params: object) -> list[Any]:
    engine = create_async_engine(_superuser_url(), pool_size=1)
    try:
        async with engine.begin() as conn:
            result = await conn.execute(text(statement), params)
            return list(result.all()) if result.returns_rows else []
    finally:
        await engine.dispose()


async def csrf(http: httpx.AsyncClient) -> str:
    response = await http.get("/api/v1/auth/session")
    response.raise_for_status()
    return str(response.json()["csrf_token"])


async def ensure_user(http: httpx.AsyncClient) -> None:
    login = await http.post(
        "/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
    )
    if login.status_code == 204:
        return
    signup = await http.post(
        "/api/v1/auth/signup",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD, "display_name": DEMO_NAME},
    )
    if signup.status_code not in (202, 409):
        raise RuntimeError(f"signup failed: {signup.status_code} {signup.text}")
    await superuser_sql(
        "UPDATE users SET email_verified_at = now() WHERE lower(email) = lower(:e)",
        e=DEMO_EMAIL,
    )
    again = await http.post(
        "/api/v1/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD}
    )
    if again.status_code != 204:
        raise RuntimeError(f"login failed after verify: {again.status_code} {again.text}")


async def ensure_org_membership() -> None:
    """Attach the demo user to the demo org (handles slug already taken by another seed)."""
    await superuser_sql(
        """
        INSERT INTO org_memberships (org_id, user_id, role, can_create_projects)
        SELECT o.id, u.id, 'owner', true
        FROM organizations o
        JOIN users u ON lower(u.email) = lower(:email)
        WHERE o.slug = :slug
        ON CONFLICT (org_id, user_id) DO UPDATE SET
          removed_at = NULL,
          role = EXCLUDED.role,
          can_create_projects = EXCLUDED.can_create_projects
        """,
        email=DEMO_EMAIL,
        slug=DEMO_ORG_SLUG,
    )


async def ensure_org(http: httpx.AsyncClient) -> None:
    session = (await http.get("/api/v1/auth/session")).json()
    if any(o["slug"] == DEMO_ORG_SLUG for o in session.get("orgs", [])):
        return
    response = await http.post(
        "/api/v1/orgs",
        json={"slug": DEMO_ORG_SLUG, "name": DEMO_ORG_NAME},
        headers={"X-CSRF-Token": await csrf(http)},
    )
    if response.status_code not in (201, 409):
        raise RuntimeError(f"create org failed: {response.status_code} {response.text}")
    if response.status_code == 409:
        await ensure_org_membership()
        return
    session = (await http.get("/api/v1/auth/session")).json()
    if not any(o["slug"] == DEMO_ORG_SLUG for o in session.get("orgs", [])):
        await ensure_org_membership()


async def org_config(org_id: uuid.UUID) -> tuple[dict[str, uuid.UUID], dict[str, uuid.UUID]]:
    types = await superuser_sql(
        "SELECT DISTINCT ON (kind) id, kind FROM issue_types WHERE org_id = :o "
        "ORDER BY kind, name = 'Task' DESC",
        o=org_id,
    )
    priorities = await superuser_sql(
        "SELECT id, name FROM priorities WHERE org_id = :o ORDER BY name", o=org_id
    )
    type_map = {str(t.kind): t.id for t in types}
    pri_map = {str(p.name): p.id for p in priorities}
    return type_map, pri_map


async def project_keys(http: httpx.AsyncClient) -> set[str]:
    response = await http.get(f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects")
    response.raise_for_status()
    return {p["key"] for p in response.json()["items"]}


async def ensure_project(http: httpx.AsyncClient, key: str, name: str, board_type: str) -> None:
    existing = await project_keys(http)
    if key in existing:
        return
    response = await http.post(
        f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects",
        json={"key": key, "name": name, "board_type": board_type},
        headers={"X-CSRF-Token": await csrf(http)},
    )
    if response.status_code != 201:
        raise RuntimeError(f"create project {key} failed: {response.status_code} {response.text}")


async def create_label(http: httpx.AsyncClient, project: str, name: str, color: str) -> uuid.UUID:
    response = await http.post(
        f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects/{project}/labels",
        json={"name": name, "color": color},
        headers={"X-CSRF-Token": await csrf(http)},
    )
    if response.status_code == 201:
        return uuid.UUID(response.json()["id"])
    if response.status_code == 409:
        listed = await http.get(f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects/{project}/labels")
        listed.raise_for_status()
        for item in listed.json()["items"]:
            if item["name"].lower() == name.lower():
                return uuid.UUID(item["id"])
    raise RuntimeError(f"label {name}: {response.status_code} {response.text}")


async def list_issues(http: httpx.AsyncClient, project: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        params: dict[str, str | int] = {"project": project, "limit": 100}
        if cursor:
            params["cursor"] = cursor
        response = await http.get(f"/api/v1/orgs/{DEMO_ORG_SLUG}/issues", params=params)
        response.raise_for_status()
        body = response.json()
        items.extend(body.get("items", []))
        cursor = body.get("next_cursor")
        if not cursor:
            return items


async def list_issue_count(http: httpx.AsyncClient, project: str) -> int:
    return len(await list_issues(http, project))


async def get_board(http: httpx.AsyncClient, project: str) -> dict[str, Any]:
    response = await http.get(f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects/{project}/board")
    response.raise_for_status()
    return dict(response.json())


async def move_issue(
    http: httpx.AsyncClient,
    issue_key: str,
    body: dict[str, Any],
    *,
    version: int | None = None,
) -> dict[str, Any]:
    headers: dict[str, str] = {"X-CSRF-Token": await csrf(http)}
    if version is not None:
        headers["If-Match"] = f'"v{version}"'
    response = await http.post(
        f"/api/v1/orgs/{DEMO_ORG_SLUG}/issues/{issue_key}/move",
        json=body,
        headers=headers,
    )
    if response.status_code != 200:
        raise RuntimeError(f"move {issue_key}: {response.status_code} {response.text}")
    return dict(response.json())


def sprint_window() -> dict[str, str]:
    now = datetime.now(UTC)
    start = now - timedelta(days=5)
    end = now + timedelta(days=9)

    def fmt(dt: datetime) -> str:
        return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    return {"start_at": fmt(start), "end_at": fmt(end)}


async def create_issue(
    http: httpx.AsyncClient,
    project: str,
    *,
    type_id: uuid.UUID,
    priority_id: uuid.UUID,
    summary: str,
    label_ids: list[uuid.UUID] | None = None,
    assignee_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "type_id": str(type_id),
        "priority_id": str(priority_id),
        "summary": summary,
    }
    if label_ids:
        payload["label_ids"] = [str(i) for i in label_ids]
    if assignee_id:
        payload["assignee_id"] = str(assignee_id)
    response = await http.post(
        f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects/{project}/issues",
        json=payload,
        headers={"X-CSRF-Token": await csrf(http), "Idempotency-Key": str(uuid.uuid4())},
    )
    if response.status_code != 201:
        raise RuntimeError(f"issue '{summary}': {response.status_code} {response.text}")
    return dict(response.json())


async def move_to_status(
    http: httpx.AsyncClient, project: str, issue_key: str, status_name: str
) -> None:
    board = await get_board(http, project)
    target_column = next(c for c in board["columns"] if c["name"] == status_name)
    status_id = target_column["status_ids"][0]
    issue = (await http.get(f"/api/v1/orgs/{DEMO_ORG_SLUG}/issues/{issue_key}")).json()
    if issue["status"]["id"] == status_id:
        return
    await move_issue(
        http,
        issue_key,
        {"to_status_id": status_id},
        version=int(issue["version"]),
    )


async def ensure_board_columns(http: httpx.AsyncClient, project: str) -> None:
    """Spread issues across To Do / In Progress / Done when everything is still in To Do."""
    board = await get_board(http, project)
    by_name = {c["name"]: c["issues"] for c in board["columns"]}
    todo_keys = [i["key"] for i in by_name.get("To Do", [])]
    in_progress = by_name.get("In Progress", [])
    done = by_name.get("Done", [])
    if in_progress and done:
        print(f"  {project} board: columns already mixed")
        return
    if len(todo_keys) < 3:
        print(f"  {project} board: not enough issues to mix columns")
        return
    await move_to_status(http, project, todo_keys[0], "In Progress")
    if len(todo_keys) > 1:
        await move_to_status(http, project, todo_keys[1], "In Progress")
    await move_to_status(http, project, todo_keys[-1], "Done")
    print(f"  {project} board: spread issues across columns")


async def ensure_scrum_active_sprint(http: httpx.AsyncClient, project: str) -> None:
    board = await get_board(http, project)
    if board.get("sprint") is not None:
        print(f"  {project}: active sprint already running")
        return
    issues = await list_issues(http, project)
    if len(issues) < 3:
        print(f"  {project}: need more issues before starting a sprint")
        return

    sprints = (await http.get(f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects/{project}/sprints")).json()[
        "items"
    ]
    planned = next((s for s in sprints if s["state"] == "future"), None)
    if planned is None:
        response = await http.post(
            f"/api/v1/orgs/{DEMO_ORG_SLUG}/projects/{project}/sprints",
            json={"name": "Sprint 1", "goal": "Ship mobile board polish and push opt-in"},
            headers={"X-CSRF-Token": await csrf(http)},
        )
        if response.status_code != 201:
            raise RuntimeError(f"sprint create: {response.status_code} {response.text}")
        planned = response.json()

    for issue in issues[:4]:
        if issue.get("sprint") and issue["sprint"]["id"] == planned["id"]:
            continue
        updated = await move_issue(
            http,
            issue["key"],
            {"sprint_id": planned["id"]},
            version=int(issue["version"]),
        )
        issue["version"] = updated["version"]

    if planned["state"] == "future":
        response = await http.post(
            f"/api/v1/orgs/{DEMO_ORG_SLUG}/sprints/{planned['id']}/start",
            json=sprint_window(),
            headers={"X-CSRF-Token": await csrf(http)},
        )
        if response.status_code != 200:
            raise RuntimeError(f"sprint start: {response.status_code} {response.text}")
    print(f"  {project}: sprint active with issues on the board")


async def seed_kanban_issues(
    http: httpx.AsyncClient,
    user_id: uuid.UUID,
    types: dict[str, uuid.UUID],
    priorities: dict[str, uuid.UUID],
) -> None:
    if await list_issue_count(http, KANBAN_KEY) >= 6:
        print(f"  {KANBAN_KEY}: issues already present")
        return
    bug = await create_label(http, KANBAN_KEY, "bug", "#e11d48")
    frontend = await create_label(http, KANBAN_KEY, "frontend", "#6a45d6")
    backend = await create_label(http, KANBAN_KEY, "backend", "#0d9488")
    stories = [
        ("Fix checkout total rounding", [frontend], "High"),
        ("Product image lazy-load", [frontend], "Medium"),
        ("Inventory sync webhook retries", [backend], "Highest"),
        ("Cart badge count wrong on mobile", [bug, frontend], "High"),
        ("Rate limit search API", [backend], "Low"),
        ("Update privacy policy copy", [], "Lowest"),
    ]
    created: list[str] = []
    for summary, labels, pri in stories:
        issue = await create_issue(
            http,
            KANBAN_KEY,
            type_id=types["standard"],
            priority_id=priorities[pri],
            summary=summary,
            label_ids=labels,
            assignee_id=(
                user_id if summary.startswith("Fix") or summary.startswith("Cart") else None
            ),
        )
        created.append(issue["key"])
    print(f"  {KANBAN_KEY}: created {len(created)} issues")


async def seed_scrum_issues(
    http: httpx.AsyncClient,
    user_id: uuid.UUID,
    types: dict[str, uuid.UUID],
    priorities: dict[str, uuid.UUID],
) -> None:
    if await list_issue_count(http, SCRUM_KEY) >= 6:
        print(f"  {SCRUM_KEY}: issues already present")
        return
    perf = await create_label(http, SCRUM_KEY, "performance", "#f59e0b")
    ux = await create_label(http, SCRUM_KEY, "ux", "#6a45d6")
    items = [
        ("Push notification opt-in flow", [perf], "High"),
        ("Offline mode for issue list", [ux], "Medium"),
        ("Biometric login on iOS", [], "Medium"),
        ("Crash on rotate in board view", [perf], "Highest"),
        ("App Store screenshot refresh", [ux], "Low"),
        ("Deep link to issue from email", [], "Low"),
    ]
    for summary, labels, pri in items:
        await create_issue(
            http,
            SCRUM_KEY,
            type_id=types["standard"],
            priority_id=priorities[pri],
            summary=summary,
            label_ids=labels,
            assignee_id=user_id,
        )
    print(f"  {SCRUM_KEY}: created {len(items)} issues (4 → sprint, 2 stay in backlog)")


async def main() -> None:
    if "POSTGRES_PASSWORD" not in os.environ:
        print(
            "Load the repo .env first (e.g. run via `make seed-demo` from repo root).",
            file=sys.stderr,
        )
        sys.exit(1)
    headers = {"Origin": ORIGIN}
    async with httpx.AsyncClient(base_url=API_BASE, headers=headers, timeout=30.0) as http:
        health = await http.get("/healthz")
        if health.status_code != 200:
            raise RuntimeError(f"API not healthy at {API_BASE} ({health.status_code})")
        print("Ensuring demo user…")
        await ensure_user(http)
        print("Ensuring demo org…")
        await ensure_org(http)
        [org_row] = await superuser_sql(
            "SELECT id FROM organizations WHERE slug = :s", s=DEMO_ORG_SLUG
        )
        [user_row] = await superuser_sql(
            "SELECT id FROM users WHERE lower(email) = lower(:e)", e=DEMO_EMAIL
        )
        org_id = org_row.id
        user_id = user_row.id
        types, priorities = await org_config(org_id)
        print("Ensuring projects…")
        await ensure_project(http, KANBAN_KEY, "Shop (Kanban)", "kanban")
        await ensure_project(http, SCRUM_KEY, "Mobile (Scrum)", "scrum")
        print("Seeding issues…")
        await seed_kanban_issues(http, user_id, types, priorities)
        await seed_scrum_issues(http, user_id, types, priorities)
        print("Board layout (kanban + scrum)…")
        await ensure_board_columns(http, KANBAN_KEY)
        await ensure_scrum_active_sprint(http, SCRUM_KEY)
        await ensure_board_columns(http, SCRUM_KEY)

    print()
    print("Demo data ready.")
    print(f"  Login:   {DEMO_EMAIL} / {DEMO_PASSWORD}")
    print(f"  Org:     /o/{DEMO_ORG_SLUG}")
    print(f"  Kanban:  /o/{DEMO_ORG_SLUG}/p/{KANBAN_KEY}/board")
    print(f"  Scrum:   /o/{DEMO_ORG_SLUG}/p/{SCRUM_KEY}/board")
    print(f"  Backlog: /o/{DEMO_ORG_SLUG}/p/{SCRUM_KEY}/backlog")


if __name__ == "__main__":
    asyncio.run(main())
