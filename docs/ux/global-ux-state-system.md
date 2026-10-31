# Global UX State System — Application-Wide Standard

This document defines **mandatory UX behavior** for every feature in the Jira Project application. It is not a page-specific design spec. All new and existing surfaces must converge on these standards over time.

**Implementation checklist (PR + milestones):** [implementation-checklist.md](./implementation-checklist.md)

**Rollout status:** **M0 complete** (documentation). **M1 complete** (shared UX library + DesignPage demo). **M2 not started** — session/offline shell awaits approval.

**Related code today (baseline):** `frontend/src/lib/api/errors.ts`, `frontend/src/lib/forms.ts`, `frontend/src/components/ui/States.tsx`, `frontend/src/components/ui/Card.tsx` (`EmptyState`, `Skeleton`), `frontend/src/components/ui/Toast.tsx`, `frontend/src/features/auth/RequireAuth.tsx`.

**Rollout:** Incremental adoption; see [Implementation plan](#implementation-plan-approved) below and the checklist doc.

---

## Objective

Establish a **consistent, reusable UX state system** across the entire application:

- Shared patterns for loading, empty, error, offline, search, permissions, session, validation, and success.
- Accessible, responsive behavior aligned with the existing SaaS design language.
- **No bypass of backend authorization.** Client checks are UX only; the server remains the source of truth.

---

## The 10 mandatory UX standards

Each standard applies to **every relevant feature**: pages, forms, API operations, search, filters, and user actions.

### 1. Empty state

**When:** A list, board, panel, or primary content area has nothing to show (not because of an error).

**Requirements:**

- Explain **why** the area is empty (no data yet vs filtered out vs permission-limited view).
- Offer **one clear next step** when the user can act (create, invite, clear filters, open backlog, etc.).
- Use the shared empty pattern (`EmptyState` or successor `UxEmptyState`) — not bare paragraph text unless the surface is intentionally minimal.

**Examples:** No projects, no issues, no members, empty backlog, no notifications, no audit events.

**Must not:** Imply the user did something wrong when the org is simply new; hide actions the user cannot perform (use permission-aware copy or standard 7 instead).

---

### 2. Loading state

**When:** Data or route context is not yet available, or the user is waiting for read operations that define page content.

**Requirements:**

- Prefer **skeletons that match the shape** of the content (table rows, cards, board columns) over generic full-page spinners.
- Minimize **layout shift** when content appears.
- For **actions** (save, move, submit): show pending state on the control (`disabled`, “Saving…”, `aria-busy` where appropriate) — not only a page-level loader.

**Must not:** Block the entire app with an undifferentiated spinner when a shaped skeleton exists for that surface.

---

### 3. Error state

**When:** A request failed or an unexpected application error occurred.

**Requirements:**

- Explain what went wrong in **plain language**.
- Identify the **source** where possible: user input, permissions, network, backend, or unexpected failure.
- Explain **how to recover** (retry, fix input, go back, contact admin).
- Provide **Retry** (or equivalent) when recovery is meaningful — especially for transient/network/server errors.
- Show **request reference** (`request_id`) when the API provides it — for support, not for debugging by end users.

**Must not:** Expose stack traces, SQL, internal service names, secrets, or raw exception messages from the server.

**Implementation note:** Map failures through `ApiError` and shared presentation (`describeError`, future `errorPresentation` mapper). Use `ErrorState` / shared error components — avoid one-off copy unless the scenario is truly unique (e.g. version conflict on issue detail).

---

### 4. No internet / offline state

**When:** The browser is offline or the server cannot be reached (`ApiError` network / status `0`).

**Requirements:**

- **Keep existing cached content visible** (React Query cache); do not blank the UI unnecessarily.
- Clearly explain which **operations require connectivity** (save, move, invite, load more, refresh).
- State what **still works** (read-only viewing of cached data where already loaded).
- **Preserve unsaved form input** in the DOM; do not clear fields because of offline detection.
- **Disable unsupported mutations** with a short explanation (not silent failure).
- On **online** again: refetch **appropriate** stale queries (e.g. `refetchOnReconnect` / targeted invalidation) — user may still need to retry a failed mutation manually.
- **Do not silently discard** user edits.

**Must not (v1):**

- Implement a **mutation queue** or background sync.
- Claim the application **fully works offline** or that changes were saved without server confirmation.

---

### 5. Network / slow connection state

**When:** Requests are in flight longer than usual, or the connection is degraded but not fully offline.

**Requirements:**

- **Distinguish three levels:** (a) normal loading (immediate skeleton/spinner), (b) **slow** request (past configurable threshold, e.g. default 8s), (c) **long-running processing** (known multi-step operations only — rare in v1).
- Slow threshold must be **configurable** (constant or env-driven default; per-query/mutation override via React Query `meta`).
- Show **real progress** only when measurable (upload bytes, known steps). **Never fabricate percentages.**
- If progress is unknown, communicate **stage** (“Still saving…”, “Loading more issues…”).
- **Avoid unnecessary global warnings** — prefer inline hints on the control or section that initiated the request.
- **Prevent duplicate submissions** while a mutation is pending (`disabled`, idempotency keys where already used).

**Must not:** Imply completion before the server confirms success.

---

### 6. No search results

**When:** Search or filters yield zero matches (distinct from “empty project” — user constrained results).

**Requirements:**

- Helpful **no-results** message tied to the query/filters.
- **Preserve the original search query** in inputs and URL — never silently rewrite what the user typed.
- **Suggestions are optional:** offer “Did you mean …?” as a **separate action** (click to apply); user must opt in.
- Use **conservative typo matching** (small edit distance, same prefix length band, limited corpus — e.g. project names on org home) — no fabricated API hits.
- Clear path to **reset filters** or broaden search.

**Examples:** Issue list `q`, board quick filters, org project search, global search bar.

---

### 7. Permission denied

**When:** The user is signed in but lacks capability for an action or page (client-known permission flag or HTTP **403**).

**Requirements:**

- Explain **which access** is missing in user terms (e.g. “Organization audit log”, “Manage sprints”).
- Explain **why** it is needed for what they tried to do.
- Provide a **safe way back** (link to org home, project, or previous page).
- Where appropriate, route to **contact an org admin** (e.g. members page) — no promise of auto-grant.

**Must not:** Bypass backend authorization in the UI; **404** may still be used for cross-tenant resource hiding — do not leak existence of private resources.

**Distinction:**

| Situation | UX |
|-----------|-----|
| Resource not found / no access (API 404) | Not found page (existing pattern) |
| Explicit forbidden (API 403) or known missing permission | Permission denied standard |

---

### 8. Session expired

**When:** The user **had an established app session** and that session is no longer valid for protected API access.

**Important — verify before implementing:** This app uses **server-side opaque sessions** (`__Host-session` cookie, ADR 0004). The frontend keeps a **CSRF token in memory only** (`fetchSession` → `setCsrfToken`). **Not every HTTP 401 means “session expired.”**

| Response | Typical meaning | Global handler |
|----------|-----------------|----------------|
| `401` + `code: unauthenticated` on protected routes while user was signed in | Session missing/expired/revoked | **Session expired flow** |
| `401` + `code: invalid_credentials` on `POST /auth/login` | Wrong password | **Form error** — not session expiry |
| `401` on `GET /auth/session` when signed out | Expected | Return `null` session — **no redirect** |
| `403` + `code: csrf_failed` | CSRF/origin mismatch | **Refresh session** / retry — not full expiry (see `useLogout` onError pattern) |

**Requirements:**

- **Single-flight:** concurrent 401s must not spawn multiple redirects or dialogs (one mutex / shared promise).
- **Opt-in drafts only:** call sites register `draftKey` + snapshot before redirect; never auto-save passwords.
- **Never auto-replay** failed mutations after login — user must explicitly retry.
- Restore route via `safeNext` on `?next=` after successful login.
- **Prevent redirect loops** (skip handler on `/login`, `/signup`, etc.; do not redirect if already handling expiry).
- On confirmed session loss: clear in-memory CSRF, invalidate session query, clear sensitive query cache as today on logout — **do not** store secrets in `localStorage`.

**Existing patterns:** `RequireAuth`, `fetchSession`, `useLogin`, `safeNext`, logout `queryClient.clear()`.

Full verified matrix (ADR 0004): [implementation-checklist.md § Authentication response handling](./implementation-checklist.md#authentication-response-handling-adr-0004--verified).

---

### 9. Form validation

**When:** Client-side or server-side validation fails on a form.

**Requirements:**

- Identify the **exact invalid field(s)**.
- Show errors **inline** next to the field.
- Explain **how to correct** the value.
- **Preserve valid** user input on failure.
- Support **accessible** announcements (`role="alert"`, `aria-invalid`, focus first error).
- Keep **frontend and backend** rules aligned; map `422` + `errors[]` via `applyServerErrors`.

**Must not:** Clear the whole form on a single field error unless the user explicitly resets.

---

### 10. Success state

**When:** A user-initiated action completed successfully.

**Requirements:**

- Clearly confirm **what** succeeded.
- Reassure that the operation **completed** (especially destructive or billing-sensitive actions).
- Explain **what happens next** when it is not obvious (navigation, email sent, sprint started).
- Use appropriate feedback: **inline** confirmation, **toast**, status change in list, or dedicated success step — pick **one primary** channel per action.

**Must not:** Show duplicate or contradictory success messages (toast + inline + navigation flash for the same action).

---

## Architecture requirements

When implementing or refactoring, prefer **reuse and consolidation**:

| Concern | Direction |
|---------|-----------|
| Shared state components | Extend `States.tsx` / introduce `components/ux/*` — one implementation per state kind |
| Loading / skeletons | Reuse page-specific skeletons (`BoardSkeleton`, issue list skeletons, `ProjectGridSkeleton`) |
| Errors | Central mapper from `ApiError` → title, body, retry, kind |
| Offline | `navigator.onLine` + connectivity listener; banner at shell level |
| Session | Global query/mutation error hook for 401 + draft preservation API |
| Success | `useToast` with deduplicated mutation feedback helper |
| Design & a11y | Existing tokens in `index.css`; `role="status"`, `role="alert"`, live regions |

**Do not:**

- Introduce a heavy abstraction for trivial one-off cases.
- Duplicate empty/error components per feature without justification.
- Change API contracts or database schemas for UX alone (unless separately approved).
- Fake offline capability, progress bars, or success.

---

## Application-wide coverage

These standards apply to **all** product areas, including:

- Authentication and account pages
- Organization dashboard, settings, members, invitations
- Project creation, settings, workflow, members
- Scrum/Kanban board, backlog, sprint management
- Issue list, create, edit, transitions, detail (page and modal)
- Comments and activity
- Search and filters (including global search)
- Audit log and administrative views
- Notifications
- Future features (attachments, reports, etc.) — adopt the same patterns at launch

Use the **per-PR feature checklist** in [implementation-checklist.md](./implementation-checklist.md#per-pr-feature-checklist) when shipping UX-related changes.

---

## Engineering constraints (non-negotiable)

- Preserve existing working functionality while migrating.
- Preserve **authorization and RBAC**; server enforcement unchanged.
- Do not discard unsaved user data on recoverable errors.
- Maintain professional SaaS visual language; reuse existing UI components.
- Accessible and responsive (keyboard, screen readers, focus management).
- No unnecessary backend changes for this standard.

---

## Error taxonomy (frontend mapping)

Use this table when choosing UX (implementation target: shared mapper):

| Signal | Typical UX standard |
|--------|---------------------|
| Network / fetch failed | 4 Offline / 3 Error + retry |
| HTTP 401 + `unauthenticated` (signed-in context) | 8 Session expired |
| HTTP 401 + `invalid_credentials` | 9 / inline form error (login) |
| HTTP 403 + `csrf_failed` | Refresh CSRF/session; retry — not full expiry |
| HTTP 403 | 7 Permission denied |
| HTTP 404 (resource) | Not found page (not permission leak) |
| HTTP 412 (version conflict) | 3 Error + preserve draft (issue detail) |
| HTTP 422 + field errors | 9 Form validation |
| HTTP 429 | 3 Error + wait |
| HTTP 5xx / 502–504 | 3 Error + retry |
| Unknown | 3 Generic error + request id |

---

## Implementation plan (approved)

**Status:** Plan approved. **M0 complete.** **M1 complete.** **M2 not started.**  
**Discipline:** One milestone per PR where possible. **No single mega-change.** Preserve API contracts, auth, authorization, and DB schemas unless separately approved. **Do not commit or push without explicit approval.**

Milestone acceptance criteria, feature coverage matrix, and testing matrix: **[implementation-checklist.md](./implementation-checklist.md)**.

---

### M0 — Documentation & gates ✅

**Scope:** Standards doc, implementation checklist, ADR 0004 auth matrix, M1–M6 boundaries, testing matrix. **Documentation only.**

| File | Action |
|------|--------|
| `docs/ux/global-ux-state-system.md` | Updated — standards, architecture, plan |
| `docs/ux/implementation-checklist.md` | Created — PR checklist, auth matrix, milestones, coverage, tests |
| `docs/ci.md` | Link for PR authors (no `.github/pull_request_template.md` in repo) |

**M0 acceptance:** All items in [checklist § M0](./implementation-checklist.md#m0--documentation-).

---

### M1 — Reusable foundations + demonstration only ✅

**Scope:** Shared library and components; **one demo surface** (e.g. extend `DesignPage` or isolated Story-like section). **Do not migrate** org/board/issue pages in M1.

| Files (create) | Purpose |
|----------------|---------|
| `frontend/src/lib/ux/types.ts` | `UxStateKind`, presentation types |
| `frontend/src/lib/ux/errorPresentation.ts` | Map `ApiError` → copy, retry, kind (401 nuanced) |
| `frontend/src/lib/ux/errorPresentation.test.ts` | Unit tests for taxonomy |
| `frontend/src/lib/ux/slowThreshold.ts` | Default + override helper |
| `frontend/src/lib/ux/draftStorage.ts` | Opt-in `sessionStorage` draft save/load/clear |
| `frontend/src/components/ux/UxErrorState.tsx` | Taxonomy-aware error UI |
| `frontend/src/components/ux/UxEmptyState.tsx` | Wrapper over `EmptyState` |
| `frontend/src/components/ux/UxPermissionDenied.tsx` | Standard forbidden UI |
| `frontend/src/components/ux/UxOfflineNotice.tsx` | Banner copy (shell-ready, not wired globally yet) |
| `frontend/src/components/ux/UxSearchEmpty.tsx` | Query preserved + optional suggestion chip |
| `frontend/src/components/ux/UxSlowHint.tsx` | Inline slow hint |
| `frontend/src/components/ux/index.ts` | Public exports |

| Files (modify) | Purpose |
|----------------|---------|
| `frontend/src/components/ui/States.tsx` | Delegate `ErrorState` → `UxErrorState` (backward compatible props) |
| `frontend/src/app/DesignPage.tsx` | **Demo gallery** of all 10 states (light/dark toggle exists via theme) |
| `frontend/src/components/ui/ui.test.tsx` | axe + render tests for new components |

**Explicitly out of M1 scope:** `AppShell` offline wiring, global 401 handler, page migrations, E2E journey changes.

**Acceptance criteria:**

- [x] `mapApiErrorToUxState` distinguishes network, 403, 404, 422, 429, 5xx, 401 `unauthenticated` vs login `invalid_credentials`.
- [x] Design/demo page shows each standard with documented copy patterns.
- [x] Vitest coverage for mapper + UX components (`ux.test.tsx`).
- [x] **Light and dark:** demo states readable in both themes.
- [x] **Keyboard:** demo components focusable; errors use `role="alert"`.
- [x] `make ci` passes (lint, typecheck, unit tests).
- [x] No change to backend or OpenAPI.

**Risks:**

| Risk | Mitigation |
|------|------------|
| Breaking `ErrorState` callers | Keep legacy props; add optional `error` mapping internally |
| Over-building in M1 | Hard cap: no imports from feature pages except DesignPage |

---

### M2 — Session expiry + offline shell

**Scope:** Global connectivity + **verified** session-loss handling only.

| Files (create) | Purpose |
|----------------|---------|
| `frontend/src/hooks/useOnlineStatus.ts` | `online` / `offline` events |
| `frontend/src/hooks/useSessionExpiryHandler.ts` | Single-flight 401 `unauthenticated` when `session` was truthy |
| `frontend/src/components/ux/UxSessionExpiredDialog.tsx` | Explain + save opt-in drafts + redirect to login |
| `frontend/src/lib/ux/registerDraft.ts` | API for features to register draft keys |

| Files (modify) | Purpose |
|----------------|---------|
| `frontend/src/app/providers.tsx` | Attach query/mutation cache listeners (401 only per table) |
| `frontend/src/app/AppShell.tsx` | `UxOfflineNotice` when offline |
| `frontend/src/lib/queryClient.ts` | `refetchOnReconnect: true` (verify defaults) |
| `frontend/src/features/auth/api.ts` | Document interaction with handler; no auto-replay |
| `frontend/src/features/issues/IssueDetailPage.tsx` | **Pilot** opt-in draft registration for summary/description |

**Acceptance criteria:**

- [ ] Multiple parallel 401s → **one** dialog/redirect (single-flight).
- [ ] Login page 401 `invalid_credentials` → **not** session dialog.
- [ ] CSRF 403 → refresh session path, not logout loop.
- [ ] Opt-in draft restored after login + `next` navigation (pilot fields).
- [ ] **No** automatic mutation replay after login.
- [ ] Offline: cached board/issue list remains visible; Save disabled with explanation.
- [ ] Online: designated queries refetch; user data in forms preserved.
- [ ] Tests: unit tests for single-flight; Vitest for 401 classification.

**Risks:**

| Risk | Mitigation |
|------|------------|
| Redirect loop | Blocklist routes; `handlingExpiry` ref |
| Stale CSRF after tab sleep | Align with existing `invalidateQueries(sessionKey)` pattern |
| Over-clearing cache | Narrow clear to session-scoped data, not full `clear()` unless true logout |

---

### M3 — Search empty results

**Scope:** Global search bar + align issue list/board empty search copy.

| Files | Purpose |
|-------|---------|
| `frontend/src/app/shell/GlobalSearchBar.tsx` | No-results panel, preserved query, optional suggestion |
| `frontend/src/lib/ux/searchSuggest.ts` | Conservative typo helper + tests |
| `frontend/src/features/issues/IssueListPage.tsx` | Use `UxSearchEmpty` where filtered empty |
| `frontend/src/features/board/BoardColumn.tsx` | Consistent filter-empty messaging |

**Acceptance criteria:**

- [x] Query never silently rewritten; suggestion is explicit click.
- [x] Clear search removes only `q`; clear filters preserves unrelated query params.
- [x] Vitest for suggest threshold (no aggressive fuzzy match).

**Rollout (M3 landed on `feat/global-ux-m3`):** Project-only corpus in `searchSuggest.ts`; org dashboard + issue list use `UxSearchEmpty`; board columns use inline copy with shared `resetBoardFiltersPreservingQuery`.

**Risks:** Suggestion false positives — cap distance and corpus size.

---

### M4 — Forms, validation focus, success dedupe

**Scope:** Conventions + high-traffic forms only (auth, create org/project, create issue, account).

| Files | Purpose |
|-------|---------|
| `frontend/src/lib/ux/mutationFeedback.ts` | Toast dedupe |
| `frontend/src/components/ui/Form.tsx` | `focusFirstError()` helper |
| Auth pages, `CreateIssueDialog.tsx`, `CreateProjectForm.tsx`, `AccountPage.tsx` | Apply helpers |

**Acceptance criteria:**

- [ ] 422 → inline fields; first error focused.
- [ ] One success signal per mutation.
- [ ] Duplicate submit prevented while pending.

**Risks:** Double toast if both inline + hook — document precedence.

---

### M5 — Org & project adoption

**Scope:** Org home, dashboard, members, settings, audit, project list/settings.

| Files | ~15–20 feature + test files listed in coverage matrix |

**Acceptance criteria:**

- [ ] Permission denied uses `UxPermissionDenied` (audit, settings).
- [ ] Role-based Vitest: member vs admin sees different affordances.
- [ ] Empty/loading/error on project grid and members list.

**Risks:** Regression on 404-as-not-found for cross-tenant — keep current behavior.

---

### M6 — Board, backlog, issues + E2E hardening

**Scope:** Remaining feature surfaces + Playwright coverage.

| Files | Board, backlog, issue detail/list, notifications, `e2e/ux-states.spec.ts` (new) |

**Acceptance criteria:**

- [ ] E2E: offline banner, reconnect refetch (smoke), session redirect with `next`, draft pilot, duplicate submit blocked, search empty.
- [ ] E2E: **light + dark** screenshots or theme toggle assertions on UX demo or one journey page.
- [ ] E2E: **keyboard** — tab to retry, dialog focus trap on session expired.
- [ ] E2E: **responsive** — offline banner + empty state at mobile viewport (existing Playwright projects).
- [ ] E2E: **permission** — member blocked from audit vs admin.
- [ ] `make ci` green.

**Risks:** Flaky offline E2E — use `context.setOffline` with stable selectors.

---

## Testing strategy (cross-milestone)

See **[implementation-checklist.md § Testing matrix](./implementation-checklist.md#testing-matrix-by-milestone)** for milestone ownership. Summary:

| Area | Unit (Vitest) | Component | E2E (Playwright) |
|------|---------------|-----------|------------------|
| Error taxonomy | `errorPresentation.test.ts` | `UxErrorState` axe | — |
| Session | 401 classification, single-flight | Dialog a11y | Multi-401, redirect `next`, no replay |
| Drafts | `draftStorage.test.ts` | — | Login restore pilot draft |
| Offline | `useOnlineStatus` | Banner | offline → online, cache visible |
| Slow | threshold helper | `UxSlowHint` | — |
| Search | `searchSuggest.test.ts` | `UxSearchEmpty` | preserved query, opt-in suggest |
| Permissions | role mocks | `UxPermissionDenied` | member vs admin audit |
| Themes | — | light/dark render | theme + critical states |
| Responsive | — | — | mobile viewport on key states |
| Keyboard | focus helpers | — | retry, dialog focus trap |
| Duplicate submit | — | — | double-click create |

---

## Document history

| Date | Change |
|------|--------|
| 2026-10-30 | Initial application-wide standard (10 UX states + architecture) |
| 2026-10-30 | Plan approved in principle; clarifications for session, offline, slow, search, testing, M1 scope |
| 2026-10-30 | **M0 complete** — checklist doc, auth matrix, CI link; M1 still blocked |
| 2026-10-30 | **M1 complete** — shared UX types/mapper/components, DesignPage demo, tests; M2 not started |
