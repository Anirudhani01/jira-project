# Data retention and purge

The worker deletes data past its retention period using the dedicated `app_retention`
database role (decision D5, plan V2.7). It does nothing unless `RETENTION_DATABASE_URL` is set.

| Data | Kept for | Rule |
|---|---|---|
| Idempotency keys | until `expires_at` (24 h) | expired |
| Email/reset tokens | 30 days after expiry | `expires_at < now() - 30 days` |
| Sessions | 30 days after expiry | `expires_at < now() - 30 days` |
| Notifications | 90 days | `created_at < now() - 90 days` |
| Org audit events | 1 year | `created_at < now() - 1 year` |
| Platform security events | 1 year | `occurred_at < now() - 1 year` |

## How it works
- The worker runs the purge every `RETENTION_INTERVAL_SECONDS` (default 3600).
- A Postgres advisory lock lets only one worker purge at a time; others log `retention.locked`.
- Deletes are batched (1000 rows) so a backlog never holds long locks.
- For the row-level-security tables the age rule is part of the policy as well, so even a faulty
  job cannot delete a fresh row.

## Checking it
- Logs: `retention.purged` (with per-table counts), `retention.failed`, `retention.locked`.
- Manual run (maintenance window): `python -c "import asyncio; from app.worker.retention import run_purge; ..."`
  with the retention engine, or simply restart the worker (it purges at start-up).

## Changing a period
Edit the rule in `backend/app/worker/retention.py` **and** the matching policy in a new
migration (for `idempotency_keys`, `notifications`, `audit_events`). A longer period needs only
the code change if the policy is looser; a shorter one needs both.
