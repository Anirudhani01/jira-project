# jira-project
alternative of jira application

An enterprise project-management platform (organizations, projects, issues, workflows,
boards, sprints), built as a modular monolith: React + TypeScript frontend, FastAPI
backend, PostgreSQL with a shared-schema tenancy design based on row-level security
(RLS), and Redis.

**Status: M2 — Email outbox, verification, password reset.** On top of M0/M1
(enumeration-safe signup, login/logout, server-side sessions, CSRF protection,
breached-password screening, auth rate limiting, platform security events): a
transactional outbox and a worker process that send verification, sign-up-notice and
password-reset emails with single-use, hashed, expiring tokens. Email delivery is off by
default; local development uses Mailpit. There are no organizations, projects or issues yet.

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
make dev                    # Postgres, Redis, Mailpit in Docker; migrations; API :8000, worker, web :5173
```

Open http://localhost:5173. Emails sent in development are captured by Mailpit (nothing
leaves your machine): http://localhost:8025. The Vite dev server proxies `/api` to the API. Interactive API
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
| `make infra-up` | Start PostgreSQL, Redis and Mailpit and wait until healthy |
| `make worker-dev` | Run the outbox worker locally (part of `make dev`) |
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

## Identity (M1, M2) at a glance

| Endpoint | Notes |
|---|---|
| `POST /api/v1/auth/signup` | Always `202`, no cookie, whether or not the email exists. Emails a verification link (new/unverified) or a notice (already registered). `404` when `SIGNUP_ENABLED` is off (default in prod). |
| `POST /api/v1/auth/verify-email` | `{token}`; verifies, rotates the current session if it is the owner's, signs out the owner's other sessions |
| `POST /api/v1/auth/password-reset/request` | `202` for every address; `503 email_unavailable` for every address while email delivery is disabled |
| `POST /api/v1/auth/password-reset/confirm` | `{token, new_password}`; password policy applies; signs out everywhere; never signs in |
| `POST /api/v1/auth/login` / `logout` | Generic `401`; sets/clears the HttpOnly session cookie |
| `GET /api/v1/auth/session` | Current user + session-bound CSRF token |
| `PATCH /api/v1/me`, `POST /api/v1/me/password` | Profile; password change rotates the session and signs out other devices |
| `GET/DELETE /api/v1/me/sessions[/{id}]`, `POST /api/v1/me/sessions/revoke-others` | Session management |

- Every state-changing request must come from the app's own origin (`Origin` header) and,
  when signed in, carry `X-CSRF-Token` from `GET /auth/session`.
- Passwords: 12–128 characters, checked against a bundled common-password list and the free
  Pwned Passwords k-anonymity API (only a 5-character hash prefix is sent). If that API is
  unreachable, signup/password change fall back to the local list only and log
  `breach_check.unavailable` (decision D7). **Production needs outbound HTTPS to
  `api.pwnedpasswords.com`.**
- Email links carry the token in the URL fragment (`/verify-email#token=…`), which is never
  sent to servers or logs. Tokens are stored as SHA-256 hashes, single-use, 24 h
  (verification) / 1 h (reset), at most 3 active per purpose.
- Email: `EMAIL_DELIVERY_ENABLED` is `false` by default. `.env.example` enables it for local
  development against Mailpit. Staging/prod require STARTTLS/TLS and SMTP credentials; **no
  production provider is configured yet** (decision D13; zero paid cost, D14).
- Worker: `python -m app.worker` (role `app_worker`, `WORKER_DATABASE_URL`); at-least-once
  delivery with retries and dead-lettering after 10 attempts. Inspect and retry dead jobs
  with `uv run python -m app.cli outbox list-dead` / `outbox requeue <id>`.
- Dev only: mark an account verified with `cd backend && uv run python -m app.cli users verify <email>`
  (refuses to run in staging/prod; there is no HTTP bypass).
- Behind a proxy, set `FORWARDED_ALLOW_IPS` to the proxy addresses so per-IP rate limits see
  real client IPs.

## Database roles

`infra/postgres/init/01-roles.sh` provisions (dev/CI only; production uses IaC):

- `app_owner` — owns the schema; used **only** by Alembic (`MIGRATION_DATABASE_URL`).
- `app_rw` — API runtime role (`DATABASE_URL`): not superuser, no BYPASSRLS, cannot create
  objects, no access to `alembic_version`.
- `app_worker` — worker runtime role (`WORKER_DATABASE_URL`): drives the outbox, mints email
  tokens; no access to sessions, read-only on users.
- `platform_security_reader` — NOLOGIN role with read access to
  `security.platform_security_events`; runtime roles can only insert there.

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
