# Global UX State System — Implementation checklist

Companion to [global-ux-state-system.md](./global-ux-state-system.md).

**Milestone status**

| Milestone | Status | Notes |
|-----------|--------|--------|
| M0 | **Complete** | Documentation only |
| M1 | **Complete** | Shared UX lib/components, DesignPage demo, tests; no feature migrations |
| M2 | **Complete** | Session/offline shell + issue-detail draft pilot |
| M3–M6 | Not started | — |

**Rules:** One milestone per PR where possible. No API/OpenAPI/DB/auth behavior changes unless separately approved. Do not commit or push without explicit approval.

---

## Per-PR feature checklist

Use when touching any user-facing surface (copy into PR description):

```text
UX standards (see docs/ux/global-ux-state-system.md)
[ ] 1 Empty — why empty + one next step (if applicable)
[ ] 2 Loading — shaped skeleton or action pending state
[ ] 3 Error — plain language, recovery, no stack/SQL; request id if available
[ ] 4 Offline — cached content kept; mutations explained if disabled (when wired)
[ ] 5 Slow — no fake progress; duplicate submit prevented on actions
[ ] 6 Search empty — query preserved; suggest opt-in only (when applicable)
[ ] 7 Permission — forbidden UX or hide action; no auth bypass
[ ] 8 Session — long forms consider opt-in draft (when handler exists)
[ ] 9 Validation — inline fields; 422 mapped; valid input kept
[ ] 10 Success — one primary confirmation channel
```

---

## Authentication response handling (ADR 0004 — verified)

**Reference:** [docs/adr/0004-identity-and-sessions.md](../adr/0004-identity-and-sessions.md)

**Model:** Opaque session token in `__Host-session` (HttpOnly, Secure, SameSite=Lax). CSRF token is `HMAC(session token)` — exposed to JS via `GET /auth/session` only; stored in memory via `setCsrfToken` (`frontend/src/lib/api/client.ts`, `frontend/src/features/auth/api.ts`).

### Response matrix (frontend handling)

| HTTP | `code` (problem+json) | Typical trigger | Current frontend behavior | Planned UX (M2+) |
|------|------------------------|-----------------|---------------------------|------------------|
| **401** | `unauthenticated` | No/invalid session cookie on **protected** route; revoked session row; `GET /auth/session` when session invalid | `fetchSession`: catch 401 → `null` session, clear CSRF. Other calls: propagate `ApiError` | **Session expired** only if app had established session (single-flight); else same as today |
| **401** | `invalid_credentials` | Wrong email/password on `POST /auth/login` | `LoginPage`: dedicated copy, not `describeError` generic | **Form validation / inline error** — never session dialog |
| **401** | (other on auth routes) | e.g. password flows | Per-page `describeError` / form handling | Classify in `errorPresentation`; no global logout |
| **403** | `csrf_failed` | Missing/invalid `X-CSRF-Token` or Origin check on unsafe methods | `useLogout` onError: invalidate session query to refresh CSRF | **Refresh session token** and let user retry; not full expiry |
| **403** | (authorization) | Org/project permission denied | Mixed: inline alerts, hidden actions, some generic `ErrorState` | **Permission denied** standard (M1 component, M5+ adoption) |

### Cases called out in product requirements

1. **`401 unauthenticated`** — Session missing, expired, idle/absolute timeout, or revoked. Triggers global session-expired flow **only** when the client previously had a authenticated session context (not on login form failure).

2. **`401 invalid_credentials`** — Login only. User-facing: “Email or password is incorrect.” **Not** session expiry.

3. **`401` on `GET /auth/session` while signed out** — Expected. `fetchSession` returns `null`; `RequireAuth` redirects to login with `next`. **No** session-expired dialog.

4. **`403 csrf_failed`** — Stale CSRF or missing header after rotation/tab sleep. Recover by refetching session (updates CSRF). **Do not** treat as full logout unless session refetch also returns unauthenticated.

### Session-expired flow requirements (M2 — not implemented yet)

- Single-flight handler for concurrent 401 `unauthenticated`.
- Opt-in `sessionStorage` drafts before redirect; never passwords/tokens in `localStorage`.
- Redirect to `/login?next=` with `safeNext`.
- **No** automatic replay of failed mutations after login.
- No redirect loops (skip auth pages, guard `handlingExpiry`).

---

## Milestone acceptance criteria

### M0 — Documentation ✅

- [x] `docs/ux/global-ux-state-system.md` — 10 standards + architecture + plan
- [x] `docs/ux/implementation-checklist.md` — this file
- [x] ADR 0004 response matrix documented
- [x] M1–M6 boundaries + testing matrix documented
- [x] Link from `docs/ci.md` for PR authors

### M1 — Foundations + demo ✅

**In scope**

- [x] `frontend/src/lib/ux/*` (types, `mapApiErrorToUxState` + tests)
- [x] `frontend/src/components/ux/*` (Error, Empty, PermissionDenied, OfflineNotice, SearchEmpty, SlowHint)
- [x] `States.tsx` delegates to shared error UI (backward compatible)
- [x] `DesignPage.tsx` demo gallery for all 10 standards
- [x] Vitest: mapper + `components/ux/ux.test.tsx` (incl. light/dark, a11y)
- [x] Light/dark + keyboard checks on demo
- [x] `make ci` passes

**Out of scope (M1) — confirmed**

- [x] No `AppShell` / `providers` global 401 or offline wiring
- [x] No migrations of org/board/issue/backlog pages
- [x] No new E2E specs
- [x] No backend/OpenAPI changes

### M2 — Session + offline shell

- [ ] `useOnlineStatus`, offline banner in shell
- [ ] `useSessionExpiryHandler` single-flight + `UxSessionExpiredDialog`
- [ ] Draft pilot on issue detail (opt-in)
- [ ] Offline: cache visible, mutations disabled with copy, reconnect refetch
- [ ] No mutation queue; no “works offline” claim
- [ ] Vitest: 401 classification, single-flight

### M3 — Search empty

- [x] `searchSuggest.ts` + unit tests (project name/key only; conservative rules)
- [x] GlobalSearchBar no-results; query preserved; clear search drops `q` only
- [x] Optional suggest — explicit click to apply via existing URL sync
- [x] Org project dashboard + issue list `UxSearchEmpty`; true empty keeps create/get-started
- [x] Board column inline filter-empty; Clear filters reuses `resetBoardFiltersPreservingQuery`
- [x] Clear filters preserves `q`; clear search preserves other params

### M4 — Forms + success

- [x] `mutationFeedback.ts` — success toast dedupe by `feedbackInvocationId` (bounded registry)
- [x] `formFocus.ts` / `focusFirstInvalidControl.ts` — server + non-RHF focus after failed submit
- [x] `firstMappedServerErrorField` in `forms.ts` (non-breaking); RHF forms + issue create + org invite
- [x] Preserve navigation / full-page / inline success; no new form success toasts; CSRF toast unchanged
- [x] One success signal per action; pending disables submit (existing `SubmitButton`)

### M5 — Permission denied UX

- [x] `permissionDenied.ts` — allowlisted copy, recovery, inline messages (no backend detail)
- [x] `UxPermissionDenied` on audit, org settings, create-project gate (after org load)
- [x] Inline 403 copy on org/project/issue mutations; mapper permission hints only (no 409)
- [x] Vitest: member vs admin, loading before deny, audit query `enabled`

### M6 — Board, backlog, issues + E2E

- [x] Board/backlog/create mutation errors via `mutationErrorMessage` (RBAC 403 inline; CSRF/session/network unchanged)
- [x] `frontend/e2e/ux-states.spec.ts` + `ux-helpers.ts` (isolated data, workers=1, auth routes excluded from 401 mock)
- [x] E2E: theme, mobile search empty, offline banner (no reload), draft restore, create POST count + pending, multi-401, safeNext, keyboard, member audit, viewer board, invite pending
- [ ] Post-merge `e2e-ux` GitHub Actions job (follow-up PR)
- [x] `make ci` green

---

## Feature coverage matrix

Legend: **Y** = must implement when milestone owns area | **y** = partial today | **—** = rare | **N/A**

| Feature | M5/M6 owner | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---------|-------------|---|---|---|---|---|---|---|---|---|---|
| Auth pages | M4 | y | y | y | Y | y | — | — | Y | Y | y |
| Home / org picker | M5 | y | y | y | Y | y | — | — | Y | — | — |
| Org dashboard | M5 | Y | Y | Y | Y | Y | Y | y | Y | — | y |
| Org settings | M5 | — | y | y | Y | y | — | Y | Y | Y | y |
| Org members & invites | M5 | y | y | y | Y | y | — | Y | Y | Y | y |
| Accept invitation | M5 | — | y | y | Y | y | — | y | Y | y | y |
| Audit log | M5 | y | y | y | Y | y | Y | Y | Y | — | — |
| Project list / create | M5 | Y | Y | Y | Y | y | Y | y | Y | Y | y |
| Project settings / workflow / members | M5 | y | y | y | Y | y | — | Y | Y | y | y |
| Board | M6 | Y | Y | Y | Y | Y | Y | y | Y | — | y |
| Backlog & sprints | M6 | y | y | y | Y | y | y | Y | Y | — | y |
| Issue list & filters | M6 | Y | Y | Y | Y | y | Y | y | Y | — | y |
| Issue detail / modal | M6 | — | y | Y | Y | Y | — | y | Y | y | y |
| Issue create dialog | M4/M6 | — | y | y | Y | y | — | y | Y | Y | y |
| Comments / activity | M6 | y | y | y | Y | y | — | y | Y | y | y |
| Global search | M3 | y | y | y | Y | y | Y | — | Y | — | — |
| Notifications | M6 | y | y | y | Y | y | — | — | Y | — | — |
| Account / sessions | M4 | y | y | y | Y | y | — | — | Y | Y | y |
| Route error boundary | M1 demo | — | — | Y | — | — | — | — | — | — | — |
| Attachments (future) | — | Y | Y | Y | Y | Y | — | Y | Y | Y | Y |

---

## Testing matrix (by milestone)

| Concern | M1 | M2 | M3 | M4 | M5 | M6 |
|---------|----|----|----|----|----|-----|
| Error taxonomy (unit) | ✅ | ✅ | — | — | — | — |
| Draft storage (unit) | ✅ | ✅ | — | — | — | E2E restore |
| 401 classification (unit) | ✅ | ✅ | — | — | — | E2E multi-401 |
| Single-flight session (unit) | — | ✅ | — | — | — | E2E |
| Offline hook (unit) | — | ✅ | — | — | — | E2E offline→online |
| Search suggest (unit) | opt | — | ✅ | — | — | E2E |
| Component axe | ✅ | ✅ | ✅ | — | — | — |
| Light / dark theme | ✅ demo | — | — | — | — | E2E |
| Responsive layout | — | banner | — | — | — | E2E mobile viewport |
| Keyboard a11y | ✅ demo | dialog | — | focus | — | E2E tab/retry |
| Permission roles | — | — | — | — | Vitest | E2E audit |
| Duplicate submit | — | — | — | ✅ | — | E2E |
| `make ci` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

---

## M1–M6 scope boundaries (summary)

| Milestone | Delivers | Explicitly excludes |
|-----------|----------|---------------------|
| **M0** | Docs + checklist | Application code |
| **M1** | `lib/ux`, `components/ux`, DesignPage demo, unit tests | Shell wiring, feature page migration, E2E |
| **M2** | Offline banner, session handler, draft pilot | Mutation queue, auto-replay, full-app migration |
| **M3** | Search empty + suggest | Server search API changes |
| **M4** | Form/success helpers + key forms | All pages |
| **M5** | Org + project surfaces | Board/issues deep migration |
| **M6** | Board/backlog/issues/notifications + E2E | Attachments (future) |

---

## Document history

| Date | Change |
|------|--------|
| 2026-10-30 | M0 complete — checklist, auth matrix, coverage, testing matrix |
