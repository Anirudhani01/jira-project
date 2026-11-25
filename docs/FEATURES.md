# Jira Project — Features, Capabilities and Functionality

_As of 2026-11-11. Compiled from the API routes (`backend/openapi.json`), backend modules, the permission model, seed data and the frontend feature folders. Not every screen was exercised by hand; see [Notes](#notes)._

## Overview

A multi-tenant, Jira-style work management app: organizations contain projects, projects contain issues, and issues move through configurable workflows on kanban and scrum boards.

| Area | Technology |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy, Alembic — a modular monolith |
| Database | PostgreSQL with row-level security (RLS) for tenant isolation |
| Cache / rate limits | Redis |
| Background work | Outbox worker (email, retention, reconciliation) |
| Frontend | React + TypeScript, built with Vite |
| API contract | OpenAPI spec; frontend types are generated from it |

Backend modules: `identity`, `orgs`, `projects`, `issues`, `boards`, `sprints`, `versions`, `comments`, `notifications`, `outbox`, `audit`, `security_events`, `org_auth_activity`.

Frontend feature areas: `auth`, `account`, `orgs`, `admin`, `projects`, `issues`, `board`, `backlog`, `comments`, `notifications`, `audit`, `authActivity`, `storyPoints`.

## Accounts and security

- **Authentication:** sign up, email verification, login, logout, password reset (request and confirm).
- **Sessions:** cookie sessions protected by CSRF and request-origin checks; view active sessions, revoke one, or revoke all others.
- **Account settings:** edit your profile; change your password.
- **Password protection:** breached-password screening; Argon2 password hashing.
- **Abuse protection:** rate limiting on sensitive endpoints.
- **Audit trail:** a per-org audit log (with filters) and separate security events.
- **Authentication activity:** per-org view of sign-in activity.
- **Data retention and operations:** retention jobs, plus runbooks for backup / point-in-time recovery, break-glass access, and observability retention (`docs/runbooks/`).

## Organizations and access control

- **Organizations:** create and switch between orgs; each has its own URL (`/o/<slug>`). Rename an org (the slug is immutable).
- **Org settings:** timezone, locale, and story-points enable / maximum.
- **Org roles:** `owner`, `admin`, `member`.
  - `owner` and `admin`: manage the org, members and invitations, view audit logs, create projects.
  - `member`: view the org.
  - A separate, audited **"can create projects"** grant can be given explicitly.
- **Members:** list, change role, remove.
- **Invitations:** invite by email, revoke, accept.
- **Permissions:** fine-grained permissions for org, project, board, sprint, version, issue and comment actions (see `backend/app/authz/permissions.py`).
- **Project roles:** `admin`, `member`, `viewer`. Holding a project role never grants org-wide rights.

## Projects

- Create, edit, archive and unarchive projects. The project key forms issue keys (for example `SHOP-1`).
- Project template picker when creating a project.
- Project members and per-project roles.
- Per-project settings, including story-point settings.
- Story-point estimation, with an org-level policy.

## Issues

- **Issue types (default):** Epic, Story, Task, Bug, Sub-task (kinds: `epic`, `standard`, `subtask`).
- **Priorities (default):** Highest, High, Medium, Low, Lowest, each with a color.
- **Core fields:** summary, description, type, priority, assignee, reporter, labels, parent / epic, fix version.
- **Operations:** create, view, edit, delete.
- **Hierarchy:** epics with child issues; sub-tasks. Per-project epics list.
- **Activity:** per-issue activity history.
- **Comments:** add, edit, delete. Markdown is rendered and sanitized server-side. Editing your own comments and deleting anyone's are separate permissions.
- **Labels:** per-project create / list / delete.
- **Issue list:** filtering, sorting, keyset pagination, inline editing of type and priority.
- **Bulk actions** (up to 100 issues): move to sprint, assign, set priority, set parent, set fix version, delete.
- **Concurrency safety:** optimistic locking via `If-Match` versions (412 stale / 428 missing), idempotency keys on create.

## Workflow, boards and planning

- **Data-driven workflows:** per-project statuses and transitions with an initial status; a workflow editor to add and remove statuses and transitions (deleting a status remaps its issues).
- **Transitions:** list the available transitions for an issue and apply one.
- **Kanban board:** columns map to workflow statuses; move issues between columns; quick filters; board-columns editor.
- **Scrum:** backlog view, sprints (create, edit, start, complete, delete), inline "Create issue" directly into a sprint.
- **Project summary:** a per-project Summary page with total, done and unassigned counts, the split across the workflow (a segmented bar plus a table of every status) and ranked issue types and priorities; every number links to the issue list with the same filter.
- **Versions / releases:** create, rename, reorder, release / unrelease, archive / unarchive, delete.

## Organization catalogs

Manage the org's issue types and priorities (Admin → Defaults & Catalogs):

- Create, rename, reorder.
- Deactivate and reactivate. A deactivated entry stays visible on existing issues but cannot be chosen for new issues or new changes. The API returns `inactive_type` / `inactive_priority`, and UI menus hide inactive entries.
- Priorities carry a hex color.
- Changes require `org.manage` (owner / admin) and are written to the audit log.

## Notifications and email

- In-app notifications: list, unread count, mark one read, mark all read.
- Email delivered by the outbox worker (Mailpit in local development).

## Admin console (`/o/<org>/admin`)

Overview · General · Defaults & Catalogs · Members · Invitations · Audit Logs · Authentication Activity · Workflows · Notifications · Email Delivery.

## UX system and quality tooling

- **UX states:** consistent loading, empty, error, permission-denied and session-expiry handling; online / offline indicator.
- **Navigation:** global sidebar, org menu, design reference page.
- **Backend tests:** 649 integration tests (including RLS, cross-tenant and migration round-trip tests) plus unit tests.
- **Frontend tests:** 510 unit / component tests and Playwright end-to-end specs.
- **CI:** lint, typecheck, OpenAPI drift check, migration round-trip.

## Notes

- This list reflects what the code and API expose. Features described in `PLAN.md` but not implemented are not listed.
- The repo contains an `AdminPlaceholderPage`, so some admin pages (for example Email Delivery or Notifications) may still be placeholders. This has not been verified.
- Known pre-existing test failure on `main`: `test_env_example_enables_local_mailpit_delivery_for_dev_only` (points at the renamed `docs/local.env.example`).
