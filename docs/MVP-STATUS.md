# MVP Status — Jira Alternative

**As of:** 2026-11-24 · **Measured against:** the MVP Definition & Release Readiness document (sections 5–11)

## How to read this

| Mark | Meaning |
|---|---|
| ✅ Done | Built, and there is automated or documented evidence |
| 🟡 Partial | Built but not fully verified, or only part of the requirement is covered |
| ❌ Not done | No evidence it exists |

Statuses come from the repository and from checks run on 2026-11-24 (test suites, CI, code and docs). Anything I could not confirm is marked 🟡 or ❌ rather than assumed.

## Summary

**Release checklist (section 10): 26 of 36 done, 3 partial, 7 not done.**

| Checklist group | ✅ | 🟡 | ❌ |
|---|---|---|---|
| Product (8) | 6 | 2 | 0 |
| Security (6) | 6 | 0 | 0 |
| Quality (8) | 8 | 0 | 0 |
| Deployment (7) | 1 | 0 | 6 |
| Portfolio (7) | 5 | 1 | 1 |

**The product is feature-complete for the MVP. The gaps are in getting it in front of people**: the hosted deployment is stopped and on the backlog (section 10), signup is disabled in the planned free-tier deployment, and the portfolio assets (screenshots in the README, architecture diagram, demo URL, descriptions) are missing.

### Blockers to calling it MVP-ready
1. **No running deployment.** A Render deployment existed and was stopped by the owner on 2026-11-25; the Antideploy attempt never worked and was removed. Bringing Render back is on the backlog (section 10).
2. **Signup would be disabled when deployed.** The free-tier config ships with `SIGNUP_ENABLED=false` because the email worker needs a paid plan or another host. Without email, nobody can register.
3. **Demo workflow not verified on a deployed environment** (follows from 1; part of the same backlog item).

---

## 1. Core user journey (section 4)

| # | Step | Status | Evidence |
|---|---|---|---|
| 1 | Register and authenticate | ✅ | Signup, email verification, login/logout, password reset |
| 2 | Create or join an organization | ✅ | Org creation, invitations (invite, revoke, accept) |
| 3 | Manage members and invitations | ✅ | Member list, role change, removal; admin console |
| 4 | Create a project | ✅ | Templates, project key, archive/unarchive |
| 5 | Configure project settings and workflow | ✅ | Workflow editor, board columns, estimates, key rename |
| 6 | Create issues | ✅ | Epic/Story/Task/Bug/Sub-task, labels, parent/epic, fix version |
| 7 | Assign work and update details | ✅ | Assignee, reporter, Tester, priority, story points |
| 8 | Manage work on a board | ✅ | Kanban and Scrum boards with drag and drop, backlog, sprints |
| 9 | Update statuses, track progress | ✅ | Transitions, activity history, notifications |
| 10 | View project-level progress | 🟡 | Org dashboard and project progress exist; no dedicated reports page (see 5.7) |
| 11 | Manage settings by permission | ✅ | Org and project settings, roles, audit log |

End-to-end journeys are written as 13 scenarios (`frontend/e2e/suites/mvp/scenarios.ts`, documented in `docs/ui-redesign/e2e-journeys.md`). **All 13 passed on 2026-11-24** against the full local stack (API, outbox worker, Mailpit, UI); see Testing.

## 2. Functional requirements (section 5)

| Area | Status | Notes |
|---|---|---|
| 5.1 Authentication & accounts | ✅ | Cookie sessions with CSRF and origin checks, session list/revoke, rate limits, breached-password screening, expired-session handling |
| 5.2 Organizations | ✅ | Roles owner/admin/member, invitations, org settings, isolation by Postgres row-level security |
| 5.3 Projects | ✅ | Create, edit, archive, members, per-project roles and settings |
| 5.4 Issues | ✅ | Full create/edit/assign, filters, sort, search, bulk actions, **saved filters** (new), optimistic locking, unique keys per project |
| 5.5 Agile boards | ✅ | Kanban and Scrum, persisted status moves, quick filters |
| 5.6 Workflow management | ✅ | Data-driven statuses and transitions; invalid transitions rejected; editor limited to authorized users |
| 5.7 Dashboard & reporting | 🟡 | Org dashboard and project progress with real done counts. No status-distribution or report page; sidebar shows "Reports — Soon" |
| 5.8 Settings & administration | 🟡 | Admin console is broad (general, catalogs, members, invitations, audit, authentication activity, workflows). `docs/FEATURES.md` notes some pages (Email Delivery, Notifications) may still be placeholders; **not verified** |

## 3. Non-functional requirements (section 6)

| Area | Status | Notes |
|---|---|---|
| 6.1 Security | ✅ | Backend permission checks; row-level security with forced RLS on tenant tables; cross-tenant tests; CSRF and cross-origin rejection; security headers (CSP, HSTS, X-Frame-Options, nosniff, Referrer-Policy); no CORS by design (same-origin proxy); secrets scanning (gitleaks) and dependency audit in CI |
| 6.2 Reliability & data integrity | ✅ | Composite foreign keys, optimistic locking, idempotency keys, migrations with round-trip test, retention jobs and runbooks |
| 6.3 Usability | ✅ | Loading, empty, error, permission-denied and session-expiry states exist. Responsive and visual QA done 2026-11-24: 27 pages × light/paper/dark × phone/tablet/desktop (243 combinations), 0 overflow and 0 serious accessibility violations after fixes; evidence in `docs/ui-redesign/evidence/2026-11-24-responsive-qa/` |
| 6.4 Performance | 🟡 | A k6 baseline exists (`infra/k6/baseline.js`); no recorded results found. List pagination is cursor-based |
| 6.5 Maintainability | ✅ | Modular monolith, ADRs, OpenAPI contract with generated types and a drift check, migrations, lint/type/test gates in CI |

## 4. Testing (section 7)

| Item | Status | Evidence |
|---|---|---|
| Backend tests | ✅ | 696 integration and 280 unit tests passed on 2026-11-24 |
| Frontend tests | ✅ | 614 unit/component tests passed on 2026-11-24 |
| CI on main | ✅ | Latest merge (#92) passed CI. The previous main run (#87, 2026-11-14) failed once; the dependency audit failure on #92 was fixed by bumping `opentelemetry-api` |
| Organization and project isolation | ✅ | Named tests, e.g. `test_cross_tenant_slug_returns_not_found`, `test_every_tenant_table_has_forced_rls_and_org_scoped_fks`, `test_inserts_into_other_tenant_are_rejected`, `test_cross_tenant_project_settings_are_not_found` |
| Mocked browser tests | ✅ | Run in CI (workflow A4b specs) |
| Full-stack end-to-end journeys | ✅ | 13 of 13 scenarios passed on 2026-11-24 (local stack). Four steps in scenarios 08 and 09 had gone stale after the UI refresh (a moved menu, a renamed button, a new confirmation dialog, a removed Search button) and were updated; the app itself behaved correctly. The full-stack suite is not part of the PR CI job; the UX-states workflow runs only on pushes to main or on manual dispatch |
| Session-expiry behaviour | ✅ | Backend expiry tests, plus the UX-states spec: 11 of 11 passed on 2026-11-24, including one dialog for concurrent 401s, return to the original page after re-login, and keyboard access |

## 5. Deployment (section 8)

> Correction (2026-11-25): the 2026-11-24 version of this document said nothing had ever been deployed. That was wrong: a Render deployment existed and has since been stopped by the owner. The statuses below describe the current state: nothing is running.

| Item | Status | Evidence |
|---|---|---|
| Frontend deployed | ❌ | Was on Render; stopped by the owner on 2026-11-25. Backlog B1 |
| Backend deployed | ❌ | Same (Render service stopped) |
| Database connected | ❌ | Supabase (direct connection); its state is unconfirmed, and free projects pause when idle. Backlog B1 |
| Migrations applied (deployed DB) | ❌ | The hosted database is behind: head is now `0027`. Must be migrated before restart. Backlog B1 |
| Deployment documented | ✅ | `DEPLOYMENT.md` (architecture, roles, env vars, rollback, verification steps) |
| Health checks | ✅ | `/healthz` and `/readyz` exist and are used by `render.yaml` |
| Logging / error visibility | 🟡 | Structured logging and runbooks exist; no deployed log destination |
| Email / signup in deployed env | ❌ | Worker not deployed; signup disabled in the free-tier config. Decision: seeded demo login, signup off (Backlog B1) |

## 6. Release checklist (section 10)

### Product
- [x] Primary user journey is functional
- [x] Organization management is functional
- [x] Project management is functional
- [x] Issue management is functional
- [x] Board functionality is functional
- [x] Workflow management is functional
- [ ] Basic reporting is functional — 🟡 dashboard and progress yes, no reports page
- [ ] Settings and administration are functional — 🟡 some admin pages unverified

### Security
- [x] Authentication works
- [x] Authorization is enforced
- [x] Organization data isolation is verified
- [x] Project access restrictions are verified
- [x] Backend validation is verified
- [x] Secrets are not exposed (`.env` is git-ignored; gitleaks scan runs in `make ci`)

### Quality
- [x] Critical backend tests pass
- [x] Critical frontend tests pass
- [x] Critical E2E journeys pass (13 of 13, 2026-11-24)
- [x] No blocking defects remain (none known)
- [x] Error states are handled
- [x] Empty states are handled
- [x] Loading states are handled
- [x] Session-expiration behavior is tested

### Deployment
- [ ] Frontend is deployed
- [ ] Backend is deployed
- [ ] Database is connected
- [ ] Migrations are applied
- [x] Deployment configuration is documented
- [ ] Product is accessible
- [ ] Demo workflow is verified on the deployed environment

### Portfolio
- [ ] README is complete — 🟡 product description, screenshots, architecture and quality are in; the demo link waits on the hosted deployment (backlog B1)
- [x] Architecture diagram is available (Mermaid diagram in the README, linked to the ADRs)
- [x] Screenshots are available (in the README and `docs/ui-redesign/evidence/2026-11-24-responsive-qa/`)
- [ ] Demo URL is available
- [x] GitHub repository is organized (docs, ADRs, CI, PR workflow)
- [x] Project description is ready (`docs/PORTFOLIO.md`)
- [x] Resume description is ready (`docs/PORTFOLIO.md`)

## 7. Known issues

| Issue | Impact |
|---|---|
| `docs/FEATURES.md` is dated 2026-11-11 with stale test counts (649 / 510) and a "known failing test" that now passes | Documentation only |
| "Reports — Soon" in the sidebar | Cosmetic; sprint reports are outside the MVP |

## 8. Outside the MVP but already built

Section 9 lists these as optional "if already implemented and stable": comments, in-app notifications, audit log and authentication activity, sprints and versions, bulk actions, saved filters. Excluded and not built: real-time collaboration, burndown/velocity analytics, automation, SSO/SCIM, billing.

## 9. Next actions, in order

1. ~~Deployment~~ **moved to the backlog on 2026-11-25** (section 10, item B1). Repeat the E2E journeys against the deployed URL when it exists.
2. ~~Run the full-stack E2E journeys~~ — done 2026-11-24 (13 of 13). Repeat the journeys against the deployed URL once it exists.
3. ~~Responsive and visual QA pass~~ — done 2026-11-24 (243 combinations clean; 30 curated screenshots in `docs/ui-redesign/evidence/2026-11-24-responsive-qa/`).
4. ~~Portfolio assets~~ — done 2026-11-25 (README, architecture diagram, screenshots, `docs/PORTFOLIO.md`). Only the demo link remains, and it waits on the deployment (backlog B1).
5. **Close the 🟡 items**: confirm which admin pages are placeholders; decide whether a small status-distribution view is needed for "basic reporting"; record a k6 baseline result.
6. **Refresh `docs/FEATURES.md`** (test counts, known-failure note).

## 10. Backlog

Work that is agreed but not scheduled. Nothing here blocks day-to-day development.

### B1 — Bring the Render deployment back (on hold, since 2026-11-25)

**Why it is on hold:** the owner stopped the Render service and chose to defer hosting. The product is feature-complete and tested locally; this item only affects *showing* it.

**What it closes:** the 6 unfinished Deployment checklist items (frontend, backend, database, migrations, accessible product, demo workflow on a deployed environment) and the portfolio "demo URL" item.

**Decisions already made**
- Access: **seeded demo login, signup off** (free). Public signup (paid Render worker, about $7/month, plus a free SMTP provider) stays a later option.
- Database: **Supabase**, **direct** connection (`db.<ref>.supabase.co`, port 5432), not the pooler (the app sets per-connection session settings).
- Antideploy is abandoned; its removal is PR #102.

**Plan, in order**
1. Confirm the facts (owner): Render backend and frontend service URLs, Supabase project still active (free projects pause when idle), Redis provider and URL, whether login worked before the stop.
2. Fix `render.yaml`: the frontend rewrite points at `https://jira-project.onrender.com`, which does not match the blueprint service name `jira-backend`; make them agree.
3. Migrate the hosted database once to head `0027` (`alembic upgrade head` with the `app_owner` URL; never downgrade; `pg_dump` first if it holds data).
4. Resume the services; verify `/healthz`, `/readyz` (database and Redis ok), SPA loads, cookie flags (`Secure; HttpOnly; SameSite=Lax`, `__Host-`), security headers.
5. Seed the demo: a small ops script creates the demo user directly (Argon2 hash through the app's hasher, no email), then loads the sample data over the hosted API; add a documented reset command.
6. Verify on the live URL: `E2E_BASE_URL=<live> make e2e-visual-qa` plus a manual core-journey pass (the 13 journeys need signup and Mailpit, so they stay local).
7. Docs and portfolio: rewrite `DEPLOYMENT.md` to what was actually done, add the demo URL to the README, update this document.

**Risks and notes:** a public demo login can be changed by anyone (hence the reset command and a README note); the hosted database is several migrations behind; the free Render backend sleeps when idle (first request is slow); local `.env` still points at an old hosted Neon database from the Antideploy attempt, so do not run `make` targets that use `DATABASE_URL` without overriding it.

**Estimate:** about half a day of work once the facts in step 1 are known, plus the owner's dashboard actions.
