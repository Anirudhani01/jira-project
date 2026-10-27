# ADR 0010 — Organizations, membership-resolved tenancy, authorization and org audit (M3)

- **Status:** Accepted (M3), pending review
- **Verification:** cross-tenant isolation for the M3 tables is **not yet verified**. The
  applicable R3.5 suite exists (`backend/tests/integration/security/`); the claim may be made
  only after it passes in GitHub Actions, and only for the tables it covers.
- **Plan references:** M3, R3.1–R3.5, R4 (creation atomicity), V2.6, V2.7, V2.9, V3.6 (D9)

## Context
M3 introduces the first tenant data. Isolation must not depend on a single layer: the
application resolves membership, and PostgreSQL independently refuses rows outside the
caller's membership even if application code were wrong.

## Decision
1. **Membership-resolved context.** `{org_slug}` is resolved once per request through the
   caller's *active* membership (`app/authz/deps.py::resolve_org`). Unknown slug, no
   membership and removed membership all yield the same `404 not_found`. The org id is
   never read from request bodies (unknown fields are rejected; `slug` changes are `422
   field_immutable`). Each handler transaction re-binds `(org_id, user_id)` and re-checks
   the membership and permission inside the same transaction (`org_transaction`).
2. **Authorization.** `app/authz/permissions.py` holds the only role → permission map.
   Org routes declare exactly one permission with `require(...)`; a route test fails CI for
   any route that is neither public, account-scoped nor tagged. D9 Option B:
   `project.create` = org owner/admin, or a member with `can_create_projects`; project roles
   grant nothing org-wide. The grant/revoke endpoint and its audit event are M4.
3. **RLS policies are membership-aware**, not just `org_id = app_current_org()`:
   - `app_rw` sees an org's rows only if the bound user is an active member of the bound org;
     config writes need owner/admin; audit reads need owner/admin.
   - Members cannot write memberships; admins may write non-owner rows; only owners create
     or change owner rows; the first owner row can be inserted only by the org's creator
     while the org has no memberships.
   - `app_worker` has read-only template policies on `organizations`/`org_memberships` for a
     job's bound org, and no access to config or audit tables.
   - Membership checks use SECURITY DEFINER helpers (`app_is_org_member`, `app_has_org_role`,
     `app_can_claim_initial_owner`, `app_shares_current_org`) owned by `app_owner` with a
     pinned `search_path`, so policies never recurse into `org_memberships`' own policies.
     `app_owner` gets explicit read policies on the two tables these helpers read; it is the
     fully trusted migration role (R3.1) and is never used at runtime.
4. **Initial-owner invariant.** A deferred constraint trigger (`org_has_owner`) rejects, at
   COMMIT, any organization without an active owner membership, whatever role inserted it.
   Org creation writes the org, owner membership, seeded issue types/priorities and the
   `org.created` audit event in one transaction. Role-change/removal locking is M4.
5. **Immutability at the database level.** `app_rw` has column-level UPDATE on
   `organizations(name, updated_at)` and `org_memberships(role, can_create_projects,
   removed_at)` only; no DELETE/TRUNCATE on tenant tables; `audit_events` is INSERT/SELECT
   only (append-only).
6. **Org audit.** `audit_events` (`org_id NOT NULL`) records `org.created` / `org.updated`
   with a per-action metadata allowlist, written in the action's transaction (fail-closed).
   IP and user agent are kept as planned (V2.7) and readable only by owners/admins; they are
   not logged anywhere else. Retention (1 year) and its purge job are M12.
7. **Outbox tenant scope.** `outbox.org_id` (nullable) with forced RLS: the API role may
   insert only NULL-org platform jobs or jobs for the bound org it belongs to. No
   tenant-scoped topic exists in M3; identity emails stay platform jobs and the worker
   dead-letters any platform job that carries an org.
8. **Rate limit:** 10 organization-creation attempts per hour per user (requests that fail
   schema validation are rejected before the limiter and do not count).

## Consequences
- Policy subqueries add a membership lookup per statement (indexed by
  `(user_id, org_id)` and the primary key); measured in M12.
- A future tenant table must add forced RLS, membership-aware policies and `org_id`-inclusive
  foreign keys, or `test_rls_catalog` fails.
- SECURITY DEFINER helpers are part of the trusted computing base; changes need review.
