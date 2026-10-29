# Deployment: Render (frontend + backend) + Supabase (PostgreSQL)

Zero-cost initial deployment. **Nothing in this document has been executed** — it is
instructions for you to run by hand in the Render and Supabase dashboards, after
reviewing `render.yaml`. No external resources were created by this change.

## Architecture

- **Frontend**: Render Static Site, serves the Vite build and rewrite-proxies `/api/*`
  to the backend so the browser sees one origin (`jira-frontend.onrender.com`). The app
  has no CORS middleware and uses a `__Host-`-prefixed session cookie by design (same
  same-origin assumption the local nginx/Vite-proxy setup already relies on) — do not
  add CORS instead of this proxy; it would require loosening cookie/CSRF assumptions
  that are out of scope for this change.
- **Backend**: Render Web Service (free), existing `backend/Dockerfile`, FastAPI/uvicorn.
- **Database**: Supabase PostgreSQL (free tier), direct connection (not the pgbouncer
  pooler — see below).
- **Redis**: required unconditionally at startup (rate limiting; `REDIS_URL` is a
  mandatory setting, not optional). Render's own Redis/Key Value offering has no lasting
  free tier. Use an external free provider, e.g. **Upstash** (free tier, `rediss://`
  TLS endpoint, Redis-protocol compatible — works fine for simple INCR/EXPIRE rate
  limiting).
- **Email / outbox worker**: `app.worker` delivers signup-verification and
  password-reset emails from an outbox table. **Not deployed** — see limitation below.

## Phase 1 findings (what the code requires)

- `DATABASE_URL`/`MIGRATION_DATABASE_URL`/`WORKER_DATABASE_URL` must use the
  `postgresql+asyncpg://` scheme (`backend/app/core/config.py`).
- `REDIS_URL` is mandatory (`redis://` or `rediss://`); the app fails to start without it.
- In `staging`/`prod` (`is_production_like`): `APP_BASE_URL` must be `https://`,
  `COOKIE_SECURE` must be `true`, `APP_SECRET_KEY` ≥ 32 chars and not a placeholder,
  `BREACH_CHECK_MODE=hibp`, and the DB role in `DATABASE_URL` must not be `postgres` or
  `app_owner` (least-privilege enforced at startup).
- Signup (`SIGNUP_ENABLED`) requires `EMAIL_DELIVERY_ENABLED=true` in prod (decision D1)
  — there is no separate "create the first admin" bootstrap path; the only way to create
  a user is `/auth/signup` + email verification. Without email delivery, **nobody can
  sign up**, including you.
- Health endpoints already exist and need no code change: `/healthz` (liveness, no
  dependency checks) and `/readyz` (503 only if PostgreSQL is unreachable/misconfigured;
  Redis failure degrades but still returns 200).
- Backend already binds `0.0.0.0` and reads `--proxy-headers`; it does **not** read
  `$PORT` (Dockerfile hardcodes 8000 for local compose) — `render.yaml` overrides the
  start command to use `$PORT`.
- `request.client.host` (used for rate-limit keys and audit) is only trusted from
  X-Forwarded-* when the peer is in `forwarded-allow-ips`; that's controlled via the
  `UVICORN_FORWARDED_ALLOW_IPS` env var (uvicorn's own `auto_envvar_prefix`), **not** the
  `FORWARDED_ALLOW_IPS` name used in `infra/docker-compose.yml` for documentation
  purposes only — set `UVICORN_FORWARDED_ALLOW_IPS=*` on Render (already in
  `render.yaml`), since only Render's own edge can reach the container.
- Frontend already calls the API via a relative path (`API_BASE = '/api/v1'` in
  `frontend/src/lib/api/client.ts`) — no hardcoded localhost, no build-time API URL
  needed, as long as the same-origin proxy (above) is in place.
- Migrations (`alembic upgrade head`) connect with `MIGRATION_DATABASE_URL` as
  `app_owner`, a role that must already exist with the grants from
  `infra/postgres/init/01-roles.sh` — Supabase does not create it for you.

## Phase 2 — Files changed

- `render.yaml` (new): backend web service + frontend static site, health check,
  rewrite-proxy routes, env var placeholders (secrets marked `sync: false`, set
  manually in the dashboard).
- `DEPLOYMENT.md` (this file, new).
- `.env.example` (appended a short "Render/Supabase production reference" comment
  block; no values changed, no secrets added).

No application code, migrations, CORS, or roadmap files were changed.

## Supabase setup (manual, one time)

1. Create a Supabase project (free tier). Note the **direct** connection string from
   Project Settings → Database → Connection string → "URI", host form
   `db.<project-ref>.supabase.co:5432`. Use this host, **not** the pooler host
   (`...pooler.supabase.com:6543`): this app sets session-level `server_settings`
   (`statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`,
   `application_name`) per connection in `backend/app/db/engine.py`, which requires
   session pooling; pgbouncer's default transaction-pooling mode on 6543 breaks that.
2. In the Supabase SQL editor, run the equivalent of
   `infra/postgres/init/01-roles.sh` by hand (adapted — Supabase's superuser is not
   literally `postgres` the same way, but the script is portable SQL):
   ```sql
   CREATE ROLE app_owner  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD '<strong-password>';
   CREATE ROLE app_rw     LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT PASSWORD '<strong-password>';
   CREATE ROLE app_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT PASSWORD '<strong-password>';
   -- Retention purge (migration 0015 requires this role to exist):
   CREATE ROLE app_retention LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT PASSWORD '<strong-password>';
   GRANT app_owner TO CURRENT_USER;  -- so the Supabase dashboard/SQL editor user can hand off ownership
   REVOKE CREATE ON SCHEMA public FROM PUBLIC;
   GRANT CONNECT ON DATABASE postgres TO app_rw, app_worker, app_retention;
   ```
   Use four different strong passwords. Do **not** reuse Supabase's own admin password.
3. Build each role's connection string:
   `postgresql+asyncpg://app_owner:<pw>@db.<ref>.supabase.co:5432/postgres?ssl=require`
   (same pattern for `app_rw`, `app_worker`, `app_retention`).
4. Run migrations **once**, before the backend's first deploy and again only when a new
   migration ships — never automatically on every instance boot (the Makefile's own
   `migrate` target and CI's `migrate-roundtrip` already follow this convention; keep
   it):
   - From your machine (with network access to Supabase and `uv` installed):
     ```bash
     cd backend
     MIGRATION_DATABASE_URL="postgresql+asyncpg://app_owner:<pw>@db.<ref>.supabase.co:5432/postgres?ssl=require" \
       uv run alembic upgrade head
     ```
   - Or, after the backend service exists on Render, via Render's Shell tab on that
     service (one-off command in its own container, not part of every startup):
     `alembic upgrade head`.
   - This preserves the RLS policies, composite FKs, grants, and tenant-isolation
     design exactly as committed — the migrations are the same ones M0–M8 already
     added and tested; nothing here changes them or resets any data.
5. Never run `alembic downgrade`/`stamp`/a fresh `upgrade head` against this database
   once it holds real data without a backup; Supabase free tier includes point-in-time
   data only on paid add-ons, so take a manual `pg_dump` first if you ever need to.

## Render setup (manual, one time)

1. Push this branch, then in the Render dashboard: **New → Blueprint**, point at this
   repo, and let it read `render.yaml`. Review the two services it proposes; do not
   click "Apply" until you've filled in the env vars below (Render lets you set
   `sync: false` values before the first deploy).
2. On `jira-backend`, set (Dashboard → Environment, all as **secrets**):
   - `DATABASE_URL`, `WORKER_DATABASE_URL`, `MIGRATION_DATABASE_URL` — the three
     Supabase connection strings from above. `RETENTION_DATABASE_URL` (the
     `app_retention` string) goes on the worker only; without it nothing is purged.
   - `REDIS_URL` — your Upstash (or other free-tier) `rediss://` URL.
   - `APP_BASE_URL` — `https://jira-frontend.onrender.com` (or your custom domain on
     the frontend), **after** the frontend service's URL is known.
   - Leave `APP_SECRET_KEY` on `generateValue: true` (Render generates and stores it).
3. In `render.yaml`'s frontend `routes`, replace
   `https://jira-backend.onrender.com` with the backend service's actual Render URL
   once assigned (Render assigns the hostname from the service name, so this is
   usually already correct — verify after first deploy, before relying on it).
4. Apply the blueprint. Render builds and deploys both services.
5. Run the Supabase migration step above (if not already done) before or immediately
   after the backend's first successful deploy — the backend will boot and respond
   `503` on `/readyz` (and reject most API requests) against an unmigrated schema, but
   it will not crash-loop, so there's no urgency-induced risk of running it twice
   unsafely.

## Email / outbox worker — limitation (documented, not worked around)

- `app.worker` (the outbox delivery process for verification/reset emails) has no
  committed deployment here. Render's **Background Worker** service type has no free
  tier; the lowest-cost compatible option is its paid **Starter** plan
  (currently ~$7/month). A commented-out `jira-worker` block is left in `render.yaml`
  for when you accept that cost.
- Without it (and without `EMAIL_DELIVERY_ENABLED=true` + a configured SMTP provider),
  `render.yaml` ships with `SIGNUP_ENABLED=false` and `EMAIL_DELIVERY_ENABLED=false` —
  the deployed app will run, but **no one can sign up** (by design: D1 forbids enabling
  signup without email delivery in prod). This is the one feature gap in an otherwise
  complete free-tier deployment.
- If/when you want signup working at zero *software* cost (accepting the ~$7/month
  Starter worker, or finding your own always-on free host for `python -m app.worker`
  outside Render), the zero-cost SMTP options to evaluate (not signed up for here):
  Brevo (free tier, 300 emails/day) or a similar free transactional-email provider with
  SMTP credentials, over TLS (`SMTP_SECURITY=starttls` or `tls`, required in prod).

## Phase 3 — Validation run in this sandbox

| Check | Command | Result |
|---|---|---|
| render.yaml syntax | `python3 -c "import yaml; yaml.safe_load(open('render.yaml'))"` | *(run below — see report)* |
| Frontend production build | `cd frontend && pnpm build` | *(run below — see report)* |
| Backend lint | `cd backend && uv run ruff check . && uv run ruff format --check .` | *(run below — see report)* |
| Backend typecheck | `cd backend && uv run mypy` | *(run below — see report)* |
| Secrets in git | `git diff --stat`, manual review of new/changed files | *(run below — see report)* |

`make ci` (full suite incl. infra-up, tests, migration round-trip, OpenAPI drift,
`make images`, `secrets-scan`) was **not** run for this change — Docker is unavailable in
this sandbox, and none of these files change backend/frontend application code, tests,
or migrations, so it doesn't gate this change. Run it before merging as a normal CI gate
(GitHub Actions will anyway).

## Verification after a real deploy (do this yourself once you apply the blueprint)

1. `curl https://jira-backend.onrender.com/healthz` → `{"status":"ok"}`.
2. `curl https://jira-backend.onrender.com/readyz` → `"database":"ok"` (after migrations
   run), `"redis":"ok"` (after `REDIS_URL` is set to a reachable instance).
3. Open `https://jira-frontend.onrender.com` → SPA loads; a request to `/api/v1/...`
   from the browser dev tools shows it going to the frontend's own origin (proxied), not
   a cross-origin call, and the session cookie (once login exists) is set with
   `Secure; HttpOnly; SameSite=Lax`.
4. Confirm `/api/v1/auth/signup` returns `404` (signup disabled) until you've accepted
   the worker/email limitation above and enabled it.

## Rollback

- **Backend/frontend code**: Render keeps previous deploys; use the dashboard's
  "Rollback to this deploy" on either service — no database impact.
- **Migrations**: do not use `alembic downgrade` against data you care about as a
  rollback mechanism; the standard, safe path is to fix forward with a new migration.
  If a migration must be reverted immediately after a bad deploy and before real data
  accumulates, run `alembic downgrade -1` manually (Shell tab or your machine) against
  `MIGRATION_DATABASE_URL`, the same way it's applied — never automatically, never
  against a database with data you haven't backed up.
- **Render blueprint changes**: `render.yaml` changes only take effect on your next
  "Apply"/deploy; reverting the commit and redeploying reverts the config.
