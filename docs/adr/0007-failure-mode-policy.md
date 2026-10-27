# ADR 0007 — Failure-mode and fail-open/closed policy

- Status: Accepted
- Plan reference: R5 (authoritative), V3.2

## Behavior implemented in M0
| Situation | Behavior |
|---|---|
| PostgreSQL unreachable | `/readyz` → 503 (`database: unavailable`); `/healthz` stays 200 (no restart storms) |
| Redis unreachable | `/readyz` → 200 with `redis: degraded` (Redis only backs rate limiting in the MVP) |
| Unsafe runtime DB role | staging/prod: refuse to start; if the DB was down at startup, readiness re-checks and reports `misconfigured` (503) |
| Unsafe configuration | staging/prod: refuse to start; error names the setting, never its value |
| Unhandled exception | generic problem+json 500; redacted traceback logged with `request_id` |
| Migration failure | Each revision runs in its own transaction (`transaction_per_migration`) with `lock_timeout=5s`; a failed revision rolls back completely |

## Later milestones (recorded here, not yet implemented)
Commit-outcome-unknown handling, outbox lease/retry/dead-letter, auth-endpoint fallback
rate limiting, and the full fail-open/closed table in plan R5 (as amended by V3.2).

## Rollback policy
Before production data exists: revert + `alembic downgrade` is acceptable. After the first
production data: roll forward with expand/contract migrations; downgrades remain tested in
CI (`make migrate-roundtrip`) but are not the recovery path for data-bearing tables; take a
PITR snapshot before data-rewriting migrations.
