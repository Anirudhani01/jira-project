# jira-project

Jira Project Management Platform
An open-source project management platform inspired by Jira, designed to help teams organize projects, manage issues, collaborate effectively and track development progress.

Built with a modern technology stack:
Frontend: React, TypeScript and Vite
Backend: Python, FastAPI
Database: PostgreSQL
Caching and background processing: Redis
Architecture: Modular monolith
Infrastructure: Docker and Docker Compose
The platform focuses on structured project management, configurable workflows, organization-level access control, issue tracking and Scrum-based development.

**Cost policy:** zero paid software cost. No paid services, subscriptions, paid APIs or
provisioned paid resources without explicit owner approval (decision D14).

- Architecture plan (with Revisions 1–3): [`docs/architecture/phase-1-plan.md`](docs/architecture/phase-1-plan.md)
- Decision log: [`docs/decisions.md`](docs/decisions.md) · ADRs: [`docs/adr/`](docs/adr/README.md)
- UI redesign roadmap and progress: [`docs/ui-redesign-plan.md`](docs/ui-redesign-plan.md) (per-PR notes under [`docs/ui-redesign/`](docs/ui-redesign/))

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker + Docker Compose v2 | recent | runs PostgreSQL 17 and Redis 7 |
| Python | 3.13 | `backend/.python-version` |
| [uv](https://docs.astral.sh/uv/) | 0.11.x | Python dependency manager (`backend/uv.lock`) |
| Node.js | 24 LTS | `.nvmrc`; enforced by `make node-version-check` and `engine-strict` (other majors fail) |
| pnpm | 10.28.0 | `corepack enable` picks it up from `frontend/package.json` |
| GNU Make | 4.x | |

Switch to the pinned Node version with `nvm use` or `fnm use` in the repository root.

## Quick start

```bash
cp docs/local-dev.env .env   # optional: local-only placeholder values; edit if you like
make install                # backend + frontend deps from lockfiles
make dev                    # Postgres, Redis, Mailpit in Docker; migrations; API :8000, worker, web :5173
```

Open http://localhost:5173. Emails sent in development are captured by Mailpit (nothing
leaves your machine): http://localhost:8025. The Vite dev server proxies `/api` to the API. Interactive API
docs (dev only): http://localhost:8000/api/docs.

Without a `.env`, the Makefile falls back to `docs/local-dev.env` (placeholder values
only; the backend refuses to start with placeholders in staging/prod). Root `.env.example`
lists production variable names for hosted deploys (Antideploy reads it for analysis).

Full stack in containers (production-like images, nginx serving the SPA on :8080):

```bash
make up      # build + start everything; http://localhost:8080
make down    # stop (keeps data)
make reset-db  # DESTRUCTIVE: also deletes the local database volume
```

## Common tasks

| Command | What it does |
|---|---|
| `make infra-up` | Start PostgreSQL, Redis and Mailpit and wait until healthy |
| `make worker-dev` | Run the outbox worker locally (part of `make dev`) |
| `make migrate` | Apply migrations to the dev DB (as `app_owner`) |
| `make test` | Backend unit + integration tests (needs `infra-up`) and frontend tests |
| `make lint` / `make typecheck` / `make fmt` | ruff + ESLint/Prettier / mypy + tsc / auto-format |
| `make migrate-roundtrip` | upgrade → downgrade base → upgrade on the test DB |
| `make openapi` / `make openapi-check` | regenerate / drift-check `backend/openapi.json` |
| `make audit` | pip-audit + pnpm audit |
| `make secrets-scan` | gitleaks over git history and the working tree (Docker) |
| `make ci` | Install, infra, lint, typecheck, parallel tests, migration round trip, OpenAPI drift, build, audit, secret scan |
| `make ci-docs` | Docs-only PRs: gitleaks only (no app tests or Docker) |
| `make test-parallel` | Backend unit + integration + frontend tests in parallel |
| `make images` | Build backend and frontend container images locally (never pushed) |

CI (`.github/workflows/ci.yml`) runs `make ci` then `make images` when applicable. **`main`** always gets the full gate. **Docs-only** PRs (explicit allowlist in `docs/ci.md`) run **`make ci-docs`**; require the **`CI`** check on PRs. See [`docs/ci.md`](docs/ci.md).

After merge to **`main`**, path-scoped pushes also run **E2E UX states** (`.github/workflows/e2e-ux.yml`): Playwright `e2e/ux-states.spec.ts` against a local dev stack (`make e2e-ux-states` with `make dev`). Not a PR-required check.


## Database roles

`infra/postgres/init/01-roles.sh` provisions (dev/CI only; production uses IaC):

- `app_owner` — owns the schema; used **only** by Alembic (`MIGRATION_DATABASE_URL`).
- `app_rw` — API runtime role (`DATABASE_URL`): not superuser, no BYPASSRLS, cannot create
  objects, no access to `alembic_version`.
- `app_worker` — worker runtime role (`WORKER_DATABASE_URL`): drives the outbox, mints email
  tokens; no access to sessions; read-only on users, organizations and memberships (under
  RLS and a job's bound org); no access to org configuration or audit tables.
- `platform_security_reader` — NOLOGIN role with read access to
  `security.platform_security_events`; runtime roles can only insert there.
- `org_auth_operator` — NOLOGIN role for A3.2 break-glass operator actions on org auth
  projection failures. Created by the same init script on **first** Postgres start
  (`infra/postgres/init/01-roles.sh` via `docker-entrypoint-initdb.d` in
  `infra/docker-compose.yml`). Migration `0018` requires this role to exist before upgrade;
  it does not `CREATE ROLE` (same pattern as `app_retention`).

**Break-glass operator access (not for `app_rw` / `app_worker` / API logins):** provision
`org_auth_operator` with init/IaC, then grant membership to a **dedicated** human break-glass
login only when needed, e.g. `GRANT org_auth_operator TO break_glass_admin` (superuser).
To reset a permanent projection failure: connect as that login, `SET ROLE org_auth_operator`,
then `SELECT security.operator_reset_org_auth_projection_failure(<platform_event_id>, '<reason>');`.
Revoke membership when the incident is closed. Never grant `org_auth_operator` to application
runtime roles.

The API checks its own role at startup and refuses to run in staging/prod with an unsafe
role (superuser, BYPASSRLS, object owner, …). See
[ADR 0003](docs/adr/0003-tenancy-shared-schema-rls.md).

## Repository layout

```
backend/    FastAPI app (app/), Alembic migrations (migrations/), tests (unit/, integration/)
frontend/   React + Vite SPA (src/), nginx config for the production image
infra/      docker-compose.yml and PostgreSQL role provisioning
docs/       architecture plan, ADRs, decision log, ui-redesign plans
.github/    CI workflow (runs `make ci`) and Dependabot
```


## Contributing

Contributions are welcome!
You can contribute by:

- Reporting bugs and suggesting improvements.
- Implementing new features.
- Improving documentation.
- Writing unit and integration tests.
- Reviewing pull requests.

Before submitting a pull request:
1. Check existing issues.
2. Create a branch for your changes.
3. Run the relevant tests.
4. Run linting and type checks.
5. Submit a pull request with a clear description.

Please refer to our contribution guidelines for development
setup and coding standards.
