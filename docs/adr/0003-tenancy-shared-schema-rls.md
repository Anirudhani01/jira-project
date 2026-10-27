# ADR 0003 — Shared-schema tenancy with PostgreSQL RLS

- Status: Accepted (decision A3)
- **Verification: NOT verified.** M0 contains no tenant tables. Cross-tenant isolation is
  unverified until the M3 cross-tenant suite (plan R3.5) is implemented and passes in CI.
  Verified in M0: runtime-role safety and tenant-context helper behavior only.
- M1 status: `users` has forced RLS (visible only as the bound user or the bound auth-lookup
  email; the org-membership branch arrives in M3). Tested in
  `tests/integration/test_identity_db.py`. This is still not cross-tenant verification:
  no tenant tables exist yet.
- M3 status: tenant tables (`organizations`, `org_memberships`, `issue_types`, `priorities`,
  `audit_events`) and the outbox have forced RLS, and the R3.5 suite applicable to M3 is
  implemented in `backend/tests/integration/security/` (restricted roles only). **Still
  "not verified"** until that suite passes in GitHub Actions; even then the claim covers
  only the M3 tables, and every later tenant table must pass the catalog/matrix tests.
  Membership-aware policies and the SECURITY DEFINER helpers are described in ADR 0010.
- Plan reference: R3 (authoritative), V2.7, V3.2

## Decision
- Every tenant-owned row carries `org_id`; every tenant table has `UNIQUE (org_id, id)` and
  references other tenant rows with **composite foreign keys that include `org_id`**
  (FK checks bypass RLS, so composite FKs — not RLS — are the mechanism intended to
  prevent cross-tenant references; to be verified by the M3+ FK-cross tests).
- Row-level security is **enabled and forced** on every tenant table, with policies that
  compare `org_id` to `app_current_org()`.
- Tenant context is bound per transaction by `app/db/tenant.py::bind_tenant` using
  transaction-local `set_config(..., true)`. Missing context ⇒ helpers return NULL ⇒ no rows
  (fail closed). An architecture test confines `set_config('app.…')` to that module.

## Database roles (provisioned by `infra/postgres/init/01-roles.sh` in dev/CI, IaC in prod)
| Role | Used by | Key properties |
|---|---|---|
| `app_owner` | Alembic only | Owns schema objects and the database; never used at runtime |
| `app_rw` | API | NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE, NOINHERIT; DML via default privileges in `public` only |
| `app_worker` | Worker (M2+) | Same attributes as `app_rw` |

The API refuses to start in staging/prod if its role is a superuser, has BYPASSRLS, owns
objects or the database, can create in `public`, or is a member of `app_owner`
(`app/db/role_check.py`); in dev it logs the violations.

## Trust boundaries — what RLS does NOT protect against
- SQL injection (any SQL as `app_rw` can call `set_config`) → parameterized queries only.
- Compromised application code or stolen runtime credentials.
- A bug that binds the wrong org → covered by membership-resolution tests (M3).
- Owner/superuser access; global tables without org scope (protected by module boundaries).

RLS is defense in depth. Each property counts as verified only when its test passes
(cross-tenant suite in plan R3.5, starting M3).
