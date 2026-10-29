# Backup and point-in-time recovery (PITR)

Applies to the production PostgreSQL. Supabase Pro (or any managed Postgres with WAL
archiving) provides PITR; the free tier gives daily backups only (see DEPLOYMENT.md).

## Targets
| | Target |
|---|---|
| RPO (data you may lose) | 5 minutes with PITR, 24 hours on daily backups only |
| RTO (time to restore service) | 2 hours |
| Backup retention | 7 days PITR window (30 days of daily snapshots if available) |

## Before you start
- [ ] You have the incident ticket and an approver (a second engineer) for any restore over live data.
- [ ] You know the **target time**: the last moment the data was known-good (UTC).
- [ ] Maintenance banner is up, or the backend is scaled to zero, so nothing writes during the restore.

## Procedure
1. **Stop writes.** Scale `jira-backend` and `jira-worker` to zero instances.
2. **Snapshot the current state** (even if damaged): take a manual backup so the restore is reversible.
3. **Restore into a new database** (never over the damaged one first):
   - Managed Postgres: use the provider's "restore to point in time" and pick the target time.
   - Self-hosted: restore the base backup, then replay WAL up to `recovery_target_time`.
4. **Verify** against the restored database before cutting over:
   ```sql
   SELECT max(version_num) FROM alembic_version;          -- expected: current head
   SELECT count(*) FROM organizations;                     -- plausible
   SELECT max(created_at) FROM audit_events;               -- <= target time
   ```
   Confirm the roles exist (`app_owner`, `app_rw`, `app_worker`, `app_retention`) and RLS is on:
   ```sql
   SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
   WHERE relname IN ('issues', 'comments', 'notifications', 'audit_events');
   ```
5. **Cut over:** point `DATABASE_URL`, `WORKER_DATABASE_URL`, `RETENTION_DATABASE_URL` and
   `MIGRATION_DATABASE_URL` at the restored database, then scale the backend back up and check
   `/readyz`.
6. **Reconcile:** sessions created after the target time no longer exist (users sign in again);
   outbox emails sent after the target time may be sent again (they are idempotent per job).
7. **Record** the incident, the target time and the data window lost in `docs/decisions.md`.

## Restore drill
Run steps 3-4 against a scratch database once per quarter and record the time it took. A
backup that has never been restored is not a backup.
