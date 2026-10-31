# UI redesign QA evidence — controlled recapture (2026-11-01)

> **Recaptured replacement evidence.** These PNGs were produced by a fresh Playwright capture run. They are **not** recovered pre-publish originals (15/16 original byte streams were never recovered on this machine).

## Commits and equivalence

| Field | Value |
|--------|--------|
| **Tested local HEAD** | `301284ec9d557301308b73c90ddf3ce8b0874bcc` |
| **Equivalent PR #60 merge** | `5da9edb38488a101200ea997c216ff065ff2198d` |
| **Synchronization gate** | Pinned to **`5da9edb`**, not tip `origin/main` (advanced to PR #61, unrelated to this recapture). |
| **Equivalence proof** | `301284e` is an ancestor of `5da9edb`; `git diff HEAD 5da9edb -- . ':(exclude)docs/ui-redesign/after'` is empty. No checkout, reset, restore, or selective file sync was performed. |

## Capture environment

| Item | Value |
|------|--------|
| **Timestamp (local)** | 2026-11-01 (IST); calendar date only — no capture start/end instant was logged in this directory. During the run, **Active sessions** on the account page (`09-account-*.png`) shows last active **Nov 1, 2026, 1:10 AM** (local). |
| **Worktree** | `jira-project-a1b` (admin) |
| **Base URL** | `http://localhost:5173` |
| **Browser** | Chromium (Playwright project `chromium`, `Desktop Chrome` device profile) |
| **Viewport** | 1280×720 (Playwright default for Desktop Chrome) |
| **Output directory** | `E2E_SCREENSHOTS` → this directory only (not `docs/ui-redesign/after/`) |

### Stack and integrity gates

1. Pre-sync SHA-256 of all 16 PNGs under `docs/ui-redesign/after/` → `pre-sync-png-sha256.txt` (read-only on `after/`).
2. Post-sync hash file → `post-sync-png-sha256.txt`; `diff` vs pre-sync empty before and after capture.
3. Before capture: DB migration `make migrate` applied pending revision **0016 → 0017** (database had been at 0016; issue create returned HTTP 500 until upgraded). Backend left running on port 8000; Vite on 5173.

## Playwright commands

```bash
export E2E_BASE_URL=http://localhost:5173
export E2E_SCREENSHOTS="/Users/Anirudh/anirudh/task-tracker/jira-project-a1b/docs/ui-redesign/evidence/2026-11-01-recapture"

# 16 screenshot tests total — three invocations (see “Playwright `-g` is global” below)
pnpm exec playwright test \
  e2e/create-project.spec.ts e2e/org-home.spec.ts \
  e2e/template-overview.spec.ts e2e/account.spec.ts

pnpm exec playwright test \
  e2e/issue-list.spec.ts e2e/board.spec.ts e2e/project-settings.spec.ts

pnpm exec playwright test \
  e2e/issue-detail.spec.ts -g "full page, activity tabs"
```

### Playwright `-g` is global

Playwright applies `-g` / `--grep` to **every** spec file on the command line. A single invocation such as `… issue-list.spec.ts board.spec.ts project-settings.spec.ts issue-detail.spec.ts -g "full page, activity tabs"` would run **only** the two issue-detail tests that match the pattern (not the 14 tests in the other seven specs). That is why capture used **three** runs above: batch 1 (eight tests), batch 2a (six tests, no grep), and batch 2b (issue-detail alone with `-g "full page, activity tabs"` for two tests). Do **not** run `issue-detail.spec.ts` without `-g` — the file includes two additional tests that do not produce `07-issue-detail-*.png`.

### Test results (screenshot specs)

| Invocation | Passed | Failed | Notes |
|------------|--------|--------|--------|
| Batch 1 (4 specs) | 8 | 0 | |
| Batch 2a — first attempt (`issue-list`, `board`, `project-settings`) | 2 | 4 | **project-settings** (2) passed; **issue-list** and **board** (4) failed — create-issue API **500** while DB was at migration **0016**. |
| Batch 2a — after `make migrate` to **0017** | 4 | 0 | Re-ran **issue-list** and **board** only (4 tests). **project-settings** PNGs from the first attempt were kept; not re-run. |
| Batch 2b (issue-detail, filtered) | 2 | 0 | Separate invocation with `-g "full page, activity tabs"`. |
| **Total screenshot tests** | **16** | **0** | All 16 PNG outputs present after completion |

### Visual QA (read-only, after capture)

A post-capture visual review inspected all 16 PNGs at 1280×720 (no regeneration, no manifest changes).

| Result | Count |
|--------|------:|
| PASS | 15 |
| WARNING | 1 |
| FAIL | 0 |

**Warning:** `05-issues-list-dark.png` — both issues (ISSUE-1, ISSUE-2) and table chrome are visible, but **issue summary text is truncated** in the Issue column at the captured viewport width (ellipsis-style clipping); not a capture or theme defect.

**Expected UI (org home):** `03-org-home-light.png` and `03-org-home-dark.png` show **“No projects for 'org-home'”** because `org-home.spec.ts` fills global search with `org-home` and asserts `?q=org-home` before screenshot — an empty filtered project grid is **expected**, not a rendering failure.

## Artifacts in this directory

| File | Purpose |
|------|---------|
| `pre-sync-png-sha256.txt` | SHA-256 of legacy `after/` PNGs before capture |
| `post-sync-png-sha256.txt` | Same after gate; must match pre-sync |
| `manifest.sha256` | SHA-256 of the 16 recaptured PNGs in this folder |
| `*.png` | Recaptured screenshots |

Verify manifest: `shasum -a 256 -c manifest.sha256`

## Screenshot inventory (16 files)

| Filename | Spec | Route / scenario |
|----------|------|------------------|
| `03-create-project-light.png` | `create-project.spec.ts` | Create project form (light) |
| `03-create-project-dark.png` | `create-project.spec.ts` | Create project form (dark) |
| `03-org-home-light.png` | `org-home.spec.ts` | Organization home (light); Projects tab with search `org-home` (empty filter — see Visual QA) |
| `03-org-home-dark.png` | `org-home.spec.ts` | Organization home (dark); same `org-home` search filter |
| `03-template-overview-kanban-light.png` | `template-overview.spec.ts` | Kanban template overview (light) |
| `03-template-overview-kanban-dark.png` | `template-overview.spec.ts` | Kanban template overview (dark) |
| `05-issues-list-light.png` | `issue-list.spec.ts` | Issues table/filters (light) |
| `05-issues-list-dark.png` | `issue-list.spec.ts` | Issues table/filters (dark); summary column may truncate at 1280×720 (Visual QA warning) |
| `06-board-light.png` | `board.spec.ts` | Board with cards, In progress populated (light) |
| `06-board-dark.png` | `board.spec.ts` | Board (dark) |
| `07-issue-detail-light.png` | `issue-detail.spec.ts` (`-g "full page, activity tabs"`) | Full-page issue detail (light) |
| `07-issue-detail-dark.png` | `issue-detail.spec.ts` (filtered) | Full-page issue detail (dark) |
| `09-account-light.png` | `account.spec.ts` | Account settings (light) |
| `09-account-dark.png` | `account.spec.ts` | Account settings (dark) |
| `10-project-settings-light.png` | `project-settings.spec.ts` | Project settings (light) |
| `10-project-settings-dark.png` | `project-settings.spec.ts` | Project settings (dark) |

Historical manifests under `.a1b-ff-png-backups/` were not modified.
