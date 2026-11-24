# Portfolio and resume descriptions

Ready-to-paste text for the project. Every number below was measured on 2026-11-25 from this repository (tests, CI runs, the OpenAPI document and the git history), so each claim can be checked. Adjust the wording to what **you** personally did, and keep only claims you can explain in an interview. The git history carries `Co-Authored-By` trailers from AI-assisted development; if you are asked how it was built, say so plainly.

## GitHub "About" box

**Description (one line):**
Multi-tenant Jira-style project management app: Kanban and Scrum boards, configurable workflows, and PostgreSQL row-level-security tenant isolation. React, TypeScript, FastAPI.

**Topics:** `react` `typescript` `fastapi` `postgresql` `row-level-security` `multi-tenant` `kanban` `scrum` `project-management` `jira-clone` `playwright` `github-actions`

## Short description (portfolio site, LinkedIn "Featured")

A Jira-inspired project management platform for small teams. Organizations hold projects, projects hold issues, and issues move through configurable workflows on Kanban and Scrum boards, with sprints, comments, notifications, saved filters and an audit trail. Each organization's data is isolated inside PostgreSQL itself with row-level security, sessions are revocable and CSRF-protected, and the whole app is tested end to end across three themes and screen sizes from phone to desktop.

## Longer description (project page)

**What it is.** A full-stack work management app in the spirit of Jira, built to show product depth and engineering discipline rather than to copy a screen. A user can sign up, create an organization, invite teammates, create a project, plan work on a Kanban or Scrum board, run sprints, comment, get notified and review an audit log, all under role-based access.

**How it is built.**
- **Frontend:** React 19 and TypeScript on Vite, TanStack Query for server state, Radix UI primitives and Tailwind CSS, with light, dark and "paper" themes. API types are generated from the backend's OpenAPI document and checked for drift in CI.
- **Backend:** a FastAPI modular monolith (14 modules, 97 REST operations) with a separate worker for email and scheduled jobs, SQLAlchemy and Alembic (26 migrations), PostgreSQL and Redis.
- **Security:** tenant isolation enforced in the database (forced row-level security, composite foreign keys, least-privilege roles checked at startup), Argon2id passwords, revocable server-side sessions in `__Host-` cookies, session-bound CSRF tokens with an origin check, rate limiting, breached-password screening and an organization audit log.
- **Reliability:** a transactional outbox for email, optimistic locking and idempotency keys for concurrent edits, and data-driven workflows editable per project.

**How it is verified.** 696 integration tests against real PostgreSQL and Redis (including cross-tenant and row-level-security tests and a migration round trip), 280 backend unit tests, 617 frontend tests, 13 Playwright user journeys, and a responsive and accessibility sweep of 27 pages in 3 themes at 3 widths (243 combinations) with no horizontal overflow and no serious axe violations. CI runs as parallel jobs, with the integration tests sharded three ways.

**Status.** Complete as an MVP and runnable locally in a few commands (`make install`, `make dev`, `make seed-demo`). It is not hosted at the moment.

## Resume entry

**Jira-style Project Management Platform** | React 19, TypeScript, FastAPI, PostgreSQL, Redis, Playwright, GitHub Actions
*Personal project, Oct to Nov 2026 | github.com/Anirudhani01/jira-project*

- Built a multi-tenant work management platform with organizations, projects, issues, Kanban and Scrum boards, sprints, configurable workflows and an audit log: 14 backend modules, 97 REST operations and 26 database migrations, with a React/TypeScript frontend of about 35k lines.
- Enforced tenant isolation in the database using PostgreSQL row-level security, composite foreign keys and least-privilege roles that the API verifies at startup, proven by cross-tenant and RLS integration tests.
- Implemented secure authentication: Argon2id password hashing, revocable server-side sessions in `__Host-` cookies, session-bound CSRF tokens with an origin check, rate limiting and breached-password screening.
- Designed for correctness under concurrency: a transactional outbox for reliable email, optimistic locking and idempotency keys, and a documented decision record (10 ADRs) for each architectural choice.
- Delivered 696 integration, 280 backend unit and 617 frontend tests, 13 Playwright user journeys, and a 243-combination responsive and accessibility sweep (3 themes, 3 screen widths) that found and fixed layout and WCAG issues, ending with zero serious violations.
- Cut CI time from about 7.8 to about 3.3 minutes with parallel jobs, three-way sharding of the integration tests, path-scoped jobs and an OpenAPI contract-drift check, alongside secret scanning and dependency auditing.

**Shorter version (3 bullets)**
- Built a multi-tenant Jira-style platform (React/TypeScript, FastAPI, PostgreSQL): Kanban and Scrum boards, sprints, configurable workflows, audit log; 97 REST operations, 26 migrations.
- Enforced per-organization data isolation with PostgreSQL row-level security and least-privilege roles, and secured sessions with Argon2id, `__Host-` cookies and session-bound CSRF tokens.
- Verified with 1,500+ automated tests, 13 Playwright journeys and a 243-combination accessibility and responsive sweep; sharded CI to cut build time by more than half.

**One-liner (headline or summary section)**
Built and tested a secure, multi-tenant Jira-style platform end to end: React/TypeScript, FastAPI, PostgreSQL row-level security, and a CI pipeline that runs 1,500+ tests in about three minutes.

## Interview talking points

Be ready to explain the trade-off behind each choice (all are written up in `docs/adr/`):
- **Modular monolith, not microservices:** one team, ACID transactions across modules, simple local setup; module boundaries keep extraction possible later (ADR 0001).
- **Row-level security, not only application filters:** a bug in one query cannot leak another organization's rows; the cost is more careful migrations and role management (ADR 0003).
- **Server-side sessions, not JWTs:** instant revocation and a session list per user, at the cost of a lookup per request (ADR 0004).
- **Transactional outbox:** email is written in the same transaction as the change and sent by a worker, so a crash never loses or duplicates a message (ADR 0009).
- **A bug the QA sweep caught:** visually hidden table text escaped its scroll box and widened the whole page on tablets; the fix was to make the table containers positioned, and the sweep now guards against it coming back.
- **A flaky test, diagnosed:** a race test passed alone but failed once under sharding; the cause was two valid outcomes (403 or 409) with only one accepted, so the test, not the app, was wrong.
- **CI engineering:** measured where the time went (the integration tests were about 5m50s of 7m), then sharded them with timing-based balancing instead of guessing.

## Be honest about the limits
- Not hosted right now (a Render deployment exists in the history and is on the backlog), so there is no live demo link yet.
- No production users or scale claims; it is a portfolio project.
- Public signup is intentionally off in the hosted configuration, because production signup requires email delivery (a paid worker plus an SMTP provider).
