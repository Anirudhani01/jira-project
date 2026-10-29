# Decision log

Precedence: Revision 3 > Revision 2 > Revision 1 > base plan
([`architecture/phase-1-plan.md`](architecture/phase-1-plan.md)). Superseded text in the
plan is marked **[SUPERSEDED]** and must not guide implementation.

| ID | Decision | Status | Where |
|---|---|---|---|
| A1 | React + TS + Vite / Python + FastAPI / PostgreSQL / Redis | Approved | ADR 0002 |
| A2 | Modular monolith + separate worker; no microservices | Approved | ADR 0001 |
| A3 | Shared schema + `org_id` + composite FKs + PostgreSQL RLS | Approved | ADR 0003 |
| A4 | Local auth (Argon2id), server-side sessions, OIDC-ready | Approved | ADR 0004 |
| A5 | Data-driven workflows/types/priorities; no custom fields in MVP | Approved | ADR 0005 |
| A6 / D12 | Polling in MVP; WebSockets deferred | Approved | plan §5.4 |
| D1 | Open self-signup; enumeration-safe; prod signup off until M2; verification gates org creation & invite acceptance | Approved | ADR 0004, plan V2.3 |
| D2 | Sessions: idle 24 h, absolute 14 d, no Remember Me, Secure/HttpOnly/SameSite=Lax, rotation, logout revokes current, reset revokes all | Approved | plan V2.4 |
| D3 | Breached-password screening (Pwned Passwords k-anonymity + local denylist) | Approved | plan V2.5 |
| D4 | Readable immutable org slugs; UUIDs internal; slugs never authorize; uniform 404 | Approved | plan V2.6 |
| D5 | Org audit 1 y (owners/admins); platform security events separate; no operator access to customer content; secrets never recorded | Approved | ADR 0008 |
| D6 | Max 20 active sessions per user, LRU eviction | Approved | plan V3.1 |
| D7 | Breach-check outage → fail open to local denylist + metric/alert; never send plaintext or full hash | Approved | plan V3.1 |
| D8 | Staging before M2 behind VPN / identity-protected gateway | Approved | plan V3.1 |
| D9 | Project creation **Option B — explicit grant only**: org owners/admins, or members explicitly granted `can_create_projects` by an owner/admin. Project-admin role confers no org-wide creation right; creating a project grants nothing | Approved | plan V3.6 |
| D10 | Viewers cannot comment or be assigned | Approved | plan V3.3 |
| D11 | Attachments deferred to v1.1 | Approved | plan V3.1 |
| D13 | Deployment provider, region, email provider: future decisions; email provider before M2 production email | Open (by design; M2 ships with delivery off by default and Mailpit for dev/test) | plan V3.1, ADR 0009 |
| D14 | **Zero paid software cost**: no paid resources, subscriptions, paid APIs or paid services without explicit owner approval | Approved | plan V3.5 |

## Verification status
Approved decisions describe intended behavior. **Cross-tenant isolation is unverified**
until the M3 cross-tenant suite (plan R3.5) passes in CI. M0 verifies only runtime-role
safety and tenant-context helper behavior.

## M0 review record
M0 accepted on local validation with recorded limitations (plan V3.7): GitHub Actions not
yet run at acceptance; exact `make images` not passed in the sandbox (intercepted TLS;
scratch-copy CA builds are supporting evidence only); cross-tenant isolation unverified
until M3; CI image builds never push or provision paid resources.

## M1 implementation record
Implemented per plan M1 / R2 / V2.3–V2.5 / V2.9. Deviations and additions (none change an
approved decision):
- CSRF token is derived (HMAC of the session token) instead of a stored hash (§4.1).
- Breach-check outage is counted in-process and logged as `breach_check.unavailable`;
  metric export and alerting arrive with observability (M12).
- Local denylist keeps only list entries of 12–128 characters (483 of 100k), since shorter
  ones are rejected by the length rule anyway.
- Extra rate limit on password change (5 per 15 minutes per user).
- `users` INSERT policy requires the bound auth-lookup email (stricter than R3.2's `true`).
- `EMAIL_DELIVERY_ENABLED=true` was rejected in every environment during M1 (lifted in M2; see below).
- `openapi-typescript` declares a TypeScript ^5 peer; it works with the pinned TypeScript 6.0.

### M1 security review (pre-commit)
Fixed, with regression tests in `backend/tests/integration/test_security_review.py`,
`tests/unit/test_security_primitives.py` and `tests/unit/test_passwords.py`:
- F1 (medium): auth rate limits were check-then-act, so concurrent attempts bypassed them
  (25/25 parallel wrong-password logins were evaluated). Now an atomic reserve/release.
- F2 (medium): SQL exception text embedded bound parameters (password/token hashes, emails)
  that could reach logs. Engine uses `hide_parameters=True`; log backstop masks emails.
- F3 (medium): the compose nginx appended to client-supplied `X-Forwarded-For` while uvicorn
  trusted `*`, so clients could choose their IP (bypassing per-IP limits, forging event
  IPs; non-IP values caused 500s). nginx now overwrites the header; non-IP peers are ignored.
- F4 (low): a 200 response that was not a range body counted as "clean"; now "unavailable".
- F6 (low): a password change/disable during login verification could still yield a session;
  the session transaction now re-checks the stored hash and status.
- F7 (low): the UI cleared its signed-in state even when the server rejected a logout, so a
  user could believe they had signed out while the session stayed valid. State is now
  cleared only on a confirmed logout, and a failure is shown.

## M2 implementation record
Implemented per plan M2 / R2 / R4 / R5 / C3 / C4 / V2.5 / V2.9; design in
[ADR 0009](adr/0009-outbox-worker-email-tokens.md). No approved decision changed.
Deviations and additions:
- **Temporary:** `outbox` has no `org_id` column and no RLS in M2. This is a deliberate,
  time-boxed decision, not a tenant-isolation assumption: all M2 jobs are global identity
  emails keyed by user id, and a unit test blocks tenant topics. M3 must add `org_id` and the
  R3.2 outbox policies before any tenant-scoped job is introduced.
- No `EMAIL_VERIFICATION_REQUIRED` flag (plan M2 rollback note): nothing is gated on
  verification until M3 (org creation, invitation acceptance), so there is nothing to toggle.
- No separate "resend verification" endpoint: as R2 specifies, signing up again with an
  unverified address re-sends the verification email (3 per hour per address).
- Added limits: reset requests 20/hour per IP (`429`); invalid token submissions 30/hour per
  IP (`429`, failures only). Per-address email limits are silent.
- Reset requests for unknown or disabled addresses enqueue a no-op job (`user_id: null`), so
  both paths do the same database work.
- Verification and reset require one click on the page (the token is never submitted on
  page load), so email link scanners cannot consume tokens.
- Password reset also marks the email verified (R1 #2) and invalidates outstanding
  verification tokens.
- Worker role tightened on M1 tables: no `user_sessions` access, `SELECT` only on `users`.
- Jobs claimed more than `WORKER_MAX_ATTEMPTS` times without an ack (repeated crashes) and
  jobs with unknown topics or malformed payloads are dead-lettered immediately.
- `EMAIL_DELIVERY_ENABLED` defaults to `false` in the application. `.env.example` enables it
  for local development only, pointing at Mailpit. With delivery off, the worker drops email
  jobs as processed without minting tokens.
- Reset requests answer `503 email_unavailable` (identical for every address) while delivery
  is disabled, instead of a `202` that would imply a link was sent.
- A failed send invalidates that attempt's token, so retries never push a delivered link out
  of the 3-token cap; an SMTP `QUIT` failure after acceptance counts as sent.
- Production delivery is still impossible by design: staging/prod require STARTTLS/TLS and
  SMTP credentials, and the provider is an open decision (D13; zero cost D14).

## M3 implementation record
Implemented per plan M3 / R3.1–R3.5 / V2.6 / V2.9 / V3.6 and the M3 checklist approvals;
design in [ADR 0010](adr/0010-orgs-authz-membership-audit.md). No approved decision changed.
- Approved M3 decisions: D9 column + policy now, grant endpoint in M4; audit read API now
  (UI/retention M12); initial-owner trigger now, owner-removal/role-change locking M4;
  org-creation limit 10/hour/user; org name 1–100 characters after trimming (API + DB check);
  worker read-only on organizations/memberships under RLS.
- Stricter than the R3.2 templates: policies require an active membership of the bound
  user (not only `org_id = app_current_org()`); audit reads require owner/admin in RLS;
  membership writes are role-restricted in RLS; `organizations` INSERT requires
  `created_by = app_current_user()`.
- Slug immutability is enforced by a column-level UPDATE grant as well as the API.
- Reserved slugs and taken slugs both return `409 slug_unavailable`.
- The R3.5 suite lives in `backend/tests/integration/security/` (not `backend/tests/security/`)
  so it shares the integration fixtures and the REQUIRE_INTEGRATION guard.
- `test_fk_cross_tenant`: M3 has no foreign keys between two org-owned tables, so the rule
  is enforced by `test_rls_catalog` (with a probe proving the check is not vacuous); row-level
  FK-cross tests start with M5/M6 tables.
- Org-creation attempts rejected by request validation (e.g. malformed slug) do not count
  toward the per-user limit; all well-formed attempts do.
- `GET /auth/session` now also returns `orgs` (plan §3.2).

### M3 security finding (fixed)
- The M1 route-guard tests (Origin check, CSRF, session required) were **vacuous**: with
  FastAPI 0.16x, `app.routes` holds lazy router wrappers, so the tests iterated zero routes
  and passed without checking anything. They now enumerate routes with
  `fastapi.routing.iter_route_contexts`, a regression test asserts the route list is not
  empty, and a mutation check (removing CSRF from a route) makes them fail as intended.
  With real enumeration, all existing routes pass, i.e. no route was actually unprotected.

## M4 implementation record (pending review)
Invitations and member management (plan M4, R4, R7-M4, D1, V3.6). Deviations/additions:
- Invitation acceptance requires a session whose **verified** email matches (D1 supersedes
  §1.6 "accepting marks email verified"); enforced in the service and in RLS
  (`app_invitation_allows`).
- Invitation tokens are minted by the worker once per invitation (stored as SHA-256); a
  redelivered job sends nothing, and a failed send clears the hash so the retry re-mints.
  A crash between minting and sending leaves the invitation unsent (revoke and re-invite).
- First tenant-scoped outbox topic: `email.org_invitation` (org_id set; worker binds it).
- Last-owner rule: per-org lock + 409 `last_owner`, backed by the deferred `org_keeps_owner`
  trigger. Members cannot leave on their own (no self-removal endpoint in M4).
- The invitation accept page is public and keeps the token in `sessionStorage` (this tab)
  across sign-in, so the token never appears in a URL query.

## M5 implementation record (pending review)
Projects, project membership and seeded configuration (plan M5, R3.3 rows 4-8/19-20, V3.6).
- All composite foreign keys include `org_id` (stricter than the R3.3 wording for rows 7
  and 20) so `test_rls_catalog` holds; board columns can only map statuses of the
  board's workflow (DB-level).
- Project-level visibility (org owners/admins + project members) is enforced in the
  application; RLS enforces org membership for reads and project-admin/org-admin rights
  for writes (SECURITY DEFINER helpers).
- Workflow view includes the board's default columns (board endpoint is M9).
- Org-member removal deletes their project memberships in the same transaction.

## M6 implementation record (pending review)
Issues core (plan M6, R3.3 rows 9-15, R4, R7-M6), migration 0007. Decisions applied:
- PATCH edits only summary, description, type and priority; assignee/parent editing (and
  setting) waits for M7. Requests forbid unknown fields, so server-owned and M7 fields → 422.
- Sub-task creation (and changing an issue to the sub-task type) → 422
  `subtask_requires_parent` until M7 adds parents.
- Interim rank: the issue number in base-62 over `0-9A-Za-z` (ASCII order), zero-padded
  to 6 characters, in `rank text COLLATE "C"`. It appends in creation order, and M9's
  base-62 between-neighbours keys use the same alphabet and column (no schema change).
  `rank` never bumps `version`.
- Project visibility on every issue route: org membership alone grants nothing; invisible
  projects answer the same 404 as unknown ones. Unlike the M5 tables, issue RLS is
  project-aware too (`app_can_view_project`, `app_can_write_issues`), and activity rows
  follow their issue.
- Idempotency keys are per (org, member, key), bound to a hash of route + project + body
  (same key, different request → 422), kept 24 h, stored with the response in the same
  transaction. A replay happens only after the in-transaction access re-check, so a caller
  who lost access gets 404. The purge job is M12.
- Org-member removal unassigns the member's live issues (version bump + activity) in the
  same transaction. `sprint_id` has no foreign key until M10; the `search` column is M12.

## M9 implementation record (pending review)
Kanban board (plan M9), migration 0010. Decisions applied:
- Migration 0010 is not "revert only" as planned: `PUT .../board/columns` needs `UPDATE (name,
  position, wip_limit)` and `DELETE` on `board_columns` and `DELETE` on
  `board_column_statuses`. New RLS policies reuse `app_can_edit_board` (project admin).
- New permission `board.manage` (project admin; org owner/admin implicitly). Audit event
  `board.columns.updated` records the project key and the column count only.
- `POST /issues/{key}/move` takes `to_status_id`, `after_key` (card above) and `before_key`
  (card below). A status change needs `If-Match` (428/412) and a workflow transition
  (422 `transition_not_permitted`); a pure reorder needs neither and never bumps `version`.
  Invalid or inverted neighbours answer 422 `invalid_position` and write nothing. With no
  neighbours the card goes to the end of its target status.
- Ranks are project-wide base-62 fractions (`issues/rank.py`); a rank longer than 64
  characters triggers a project-wide rebalance in the same transaction. Sprint-aware moves
  and the scrum board's active sprint are M10.
- Board read: not-done cards plus those done in the last 14 days, capped at 500
  (`truncated`), in (rank, id) order, with the workflow transitions for drop targets.
- Frontend: dnd-kit pointer and keyboard sensors with live announcements, plus a "Move to"
  menu per card; the plan is computed before the optimistic update (the mutation runs after
  `onMutate`), and failures restore the snapshot. Playwright E2E is not in the repository yet.

## Open questions
- Retention of platform security events (proposed 1 y), application logs (30 d), traces (14 d).
- Org audit events after org deletion (needed before org deletion is built).
- Production proxy chain must overwrite `X-Forwarded-For` at the edge and set
  `FORWARDED_ALLOW_IPS` to the exact proxy addresses (never `*` when the backend is
  reachable by anything other than the trusted proxy).
- Production egress to `api.pwnedpasswords.com` must be allowed, otherwise breach screening
  silently runs in local-denylist-only mode (observed in the development sandbox).
- Whether org admins later see their members' login events.
- Org audit IP address and user agent (M3): retained per V2.7 and visible to owners/admins
  only; the 1-year retention job, any minimisation (e.g. truncating IPs) and the privacy
  notice are to be settled with the M12 retention work.
- Email provider (D13): must support STARTTLS/TLS + SMTP auth and stay within D14 (free tier
  or explicit approval). Until then `EMAIL_DELIVERY_ENABLED` must stay `false` outside
  dev/test, which also keeps prod signup off (D1).
