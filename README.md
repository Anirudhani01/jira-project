# jira-project
alternative of jira application

An enterprise project-management platform (organizations, projects, issues, workflows,
boards, sprints), built as a modular monolith: React + TypeScript frontend, FastAPI
backend, PostgreSQL with a shared-schema tenancy design based on row-level security
(RLS), and Redis.

**Status: M0 — Foundations.** The repository contains the development environment,
database roles and baseline migration, the backend/frontend skeletons, quality gates and
CI. There are no product features yet (no auth, organizations or issues).

> **Verification status — tenant isolation is NOT yet verified.** No tenant-owned tables
> exist in M0, so there is nothing to isolate yet. Cross-tenant isolation remains
> **unverified until the M3 cross-tenant test suite (plan R3.5) is implemented and passes
> in CI**. What M0 does verify (by tests): the runtime database role is least-privileged
> (not superuser, no BYPASSRLS, owns nothing, cannot create objects), and the
> tenant-context helpers return NULL without context and do not leak between transactions.
> Statements about isolation in the docs describe the *design*, not proven behavior.

**Cost policy:** zero paid software cost. No paid services, subscriptions, paid APIs or
provisioned paid resources without explicit owner approval (decision D14).

- Architecture plan (with Revisions 1–3): [`docs/architecture/phase-1-plan.md`](docs/architecture/phase-1-plan.md)
- Decision log: [`docs/decisions.md`](docs/decisions.md) · ADRs: [`docs/adr/`](docs/adr/README.md)

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
cp .env.example .env        # optional: local-only placeholder values; edit if you like
make install                # backend + frontend deps from lockfiles
make dev                    # Postgres + Redis in Docker, migrations, API :8000, web :5173
```

Open http://localhost:5173. The Vite dev server proxies `/api` to the API. Interactive API
docs (dev only): http://localhost:8000/api/docs.

Without a `.env`, the Makefile falls back to `.env.example` (placeholder values only; the
backend refuses to start with placeholders in staging/prod).

Full stack in containers (production-like images, nginx serving the SPA on :8080):

```bash
make up      # build + start everything; http://localhost:8080
make down    # stop (keeps data)
make reset-db  # DESTRUCTIVE: also deletes the local database volume
```

## Common tasks

| Command | What it does |
|---|---|
| `make infra-up` | Start PostgreSQL and Redis and wait until healthy |
| `make migrate` | Apply migrations to the dev DB (as `app_owner`) |
| `make test` | Backend unit + integration tests (needs `infra-up`) and frontend tests |
| `make lint` / `make typecheck` / `make fmt` | ruff + ESLint/Prettier / mypy + tsc / auto-format |
| `make migrate-roundtrip` | upgrade → downgrade base → upgrade on the test DB |
| `make openapi` / `make openapi-check` | regenerate / drift-check `backend/openapi.json` |
| `make audit` | pip-audit + pnpm audit |
| `make secrets-scan` | gitleaks over git history and the working tree (Docker) |
| `make ci` | Install, infra, lint, typecheck, tests, migration round trip, OpenAPI drift, build, audit, secret scan |
| `make images` | Build backend and frontend container images locally (never pushed) |

CI (`.github/workflows/ci.yml`) runs exactly `make ci` followed by `make images`.

## Database roles

`infra/postgres/init/01-roles.sh` provisions (dev/CI only; production uses IaC):

- `app_owner` — owns the schema; used **only** by Alembic (`MIGRATION_DATABASE_URL`).
- `app_rw` — API runtime role (`DATABASE_URL`): not superuser, no BYPASSRLS, cannot create
  objects, no access to `alembic_version`.
- `app_worker` — worker runtime role (used from M2).

The API checks its own role at startup and refuses to run in staging/prod with an unsafe
role (superuser, BYPASSRLS, object owner, …). See
[ADR 0003](docs/adr/0003-tenancy-shared-schema-rls.md).

## Repository layout

```
backend/    FastAPI app (app/), Alembic migrations (migrations/), tests (unit/, integration/)
frontend/   React + Vite SPA (src/), nginx config for the production image
infra/      docker-compose.yml and PostgreSQL role provisioning
docs/       architecture plan, ADRs, decision log
.github/    CI workflow (runs `make ci`) and Dependabot
```
