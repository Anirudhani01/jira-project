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

**Release checklist (section 10): 20 of 36 done, 6 partial, 10 not done.**

| Checklist group | ✅ | 🟡 | ❌ |
|---|---|---|---|
| Product (8) | 6 | 2 | 0 |
| Security (6) | 6 | 0 | 0 |
| Quality (8) | 6 | 2 | 0 |
| Deployment (7) | 1 | 0 | 6 |
| Portfolio (7) | 1 | 2 | 4 |

**The product is feature-complete for the MVP. The gaps are in getting it in front of people**: nothing is deployed, signup is disabled in the planned free-tier deployment, and the portfolio assets (screenshots in the README, architecture diagram, demo URL, descriptions) are missing.

### Blockers to calling it MVP-ready
1. **No deployment.** `render.yaml` and `DEPLOYMENT.md` are prepared, but `DEPLOYMENT.md` states nothing has been executed, and the repo contains no live URL.
2. **Signup would be disabled when deployed.** The free-tier config ships with `SIGNUP_ENABLED=false` because the email worker needs a paid plan or another host. Without email, nobody can register.
3. **Demo workflow not verified on a deployed environment** (follows from 1).

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

End-to-end journeys are written as 13 scenarios (`frontend/e2e/suites/mvp/scenarios.ts`, documented in `docs/ui-redesign/e2e-journeys.md`). The full-stack run was **not re-run** for this document; see Quality.

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
| 6.3 Usability | 🟡 | Loading, empty, error, permission-denied and session-expiry states exist. **Responsive layouts have not had a full sweep** (planned QA pass; it already found one phone-width bug on the issue list) |
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
| Full-stack end-to-end journeys | 🟡 | Written and documented; not re-run for this document. The UX-states workflow runs only on pushes to main or on manual dispatch |
| Session-expiry behaviour | 🟡 | Backend expiry tests exist; the browser behaviour is covered by the full-stack UX-states spec, which has not been re-run |

## 5. Deployment (section 8)

| Item | Status | Evidence |
|---|---|---|
| Frontend deployed | ❌ | Prepared in `render.yaml`; no deployed URL found |
| Backend deployed | ❌ | Same |
| Database connected | ❌ | Supabase steps documented, "nothing has been executed" |
| Migrations applied (deployed DB) | ❌ | Documented procedure only |
| Deployment documented | ✅ | `DEPLOYMENT.md` (architecture, roles, env vars, rollback, verification steps) |
| Health checks | ✅ | `/healthz` and `/readyz` exist and are used by `render.yaml` |
| Logging / error visibility | 🟡 | Structured logging and runbooks exist; no deployed log destination |
| Email / signup in deployed env | ❌ | Worker not deployed; signup disabled in the free-tier config |

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
- [ ] Critical E2E journeys pass — 🟡 not re-run
- [x] No blocking defects remain (none known)
- [x] Error states are handled
- [x] Empty states are handled
- [x] Loading states are handled
- [ ] Session-expiration behavior is tested — 🟡 see section 4

### Deployment
- [ ] Frontend is deployed
- [ ] Backend is deployed
- [ ] Database is connected
- [ ] Migrations are applied
- [x] Deployment configuration is documented
- [ ] Product is accessible
- [ ] Demo workflow is verified on the deployed environment

### Portfolio
- [ ] README is complete — 🟡 setup-focused; no product description, screenshots or demo link
- [ ] Architecture diagram is available — ❌ an architecture plan and ADRs exist, no diagram found
- [ ] Screenshots are available — 🟡 images exist under `docs/`, not shown in the README
- [ ] Demo URL is available
- [x] GitHub repository is organized (docs, ADRs, CI, PR workflow)
- [ ] Project description is ready
- [ ] Resume description is ready

## 7. Known issues

| Issue | Impact |
|---|---|
| Issue-list row Assignee buttons raise an axe `label-content-name-mismatch` warning (5 on the demo project) | Accessibility, not blocking |
| Responsive and visual QA across all pages and themes not yet done | Possible layout bugs at phone width |
| `docs/FEATURES.md` is dated 2026-11-11 with stale test counts (649 / 510) and a "known failing test" that now passes | Documentation only |
| "Reports — Soon" in the sidebar | Cosmetic; sprint reports are outside the MVP |

## 8. Outside the MVP but already built

Section 9 lists these as optional "if already implemented and stable": comments, in-app notifications, audit log and authentication activity, sprints and versions, bulk actions, saved filters. Excluded and not built: real-time collaboration, burndown/velocity analytics, automation, SSO/SCIM, billing.

## 9. Next actions, in order

1. **Decide how the deployed app handles signup**, then deploy. Options: (a) pay about $7/month for the email worker plus a free SMTP provider such as Brevo; (b) keep signup off and provide a seeded demo login (needs a safe way to seed the deployed database, which is not documented yet). Then run the Supabase and Render steps in `DEPLOYMENT.md` and verify with the checks listed there.
2. **Run the full-stack E2E journeys** (`make e2e-journeys` against `make dev`) and record the result here; do the same on the deployed URL.
3. **Responsive and visual QA pass** (planned): all pages, light/paper/dark, phone/tablet/desktop, plus the Assignee-button fix. Keep a curated set of screenshots as evidence.
4. **Portfolio assets**: README (product description, screenshots, demo link), architecture diagram, project and resume descriptions.
5. **Close the 🟡 items**: confirm which admin pages are placeholders; decide whether a small status-distribution view is needed for "basic reporting"; record a k6 baseline result.
6. **Refresh `docs/FEATURES.md`** (test counts, known-failure note).
