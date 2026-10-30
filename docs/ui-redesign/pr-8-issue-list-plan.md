# PR 8 — Issue list (progress)

Full spec: [`ui-redesign-plan.md`](../ui-redesign-plan.md) §8d PR 8. This doc tracks **what is implemented locally** vs what remains for a complete PR 8 merge.

## Done locally (frontend)

| Area | Implementation |
|------|----------------|
| Page chrome | `IssueListPage` — `PageHeader`, filter bar (URL: `status_category`, `type`, `priority`, `assignee`, `q`), empty/loading states, cursor pagination |
| Table shell | `components/ui/DataGrid.tsx` — `role="table"`, equal-width columns, divided cells, `scope="col"` on headers |
| Issue table | `features/issues/IssueListTable.tsx` + `IssueListTableRow` — five logical fields, **3–5 visible columns** depending on picker |
| Column model | `issueListColumns.ts` — Issue / Type / Priority always on; **Status** and **Assignee** optional; persisted per org+project in `localStorage` (`jira.issues.columns.{org}.{KEY}`); legacy `type`/`priority` keys ignored |
| Column count | `issueListTableColumnCount()` — `3 +` optional toggles; headers, body cells, and grid width stay aligned |
| Column picker | `IssueListColumnPicker.tsx` — Radix `DropdownMenuCheckboxItem` with `aria-checked` for optional columns |
| Row controls | `IssueListRowMenus.tsx` — inline status/type/priority/assignee (and reporter on detail); permissions-aware |
| Detail polish | `IssueDetailPage` — design-system layout, inline summary/description edit, shared row menus |
| Tests | `issueListColumns.test.ts`, `issues.test.tsx` (column headers + picker), `ui.test.tsx` (DataGrid) |

## Not done (still PR 8 scope)

- Server **sort** by `key`, `priority`, `status` (today: `updated_at` / `created_at` only)
- **`label`** (and any other missing) query params on `GET /orgs/{org}/issues`
- Sticky header, label column, sprint filter chip, row overflow actions menu
- `/` focus shortcut (PR 9), saved filters (PR 14)
- Full E2E journey updates (main `journey.spec.ts` still uses legacy link selectors in places)

## Screenshots (`docs/ui-redesign/after/`)

Capture with a running stack (`make dev` in one terminal):

```bash
make e2e-pr8
```

| File | Route | Notes |
|------|--------|--------|
| `05-issues-list-light.png` | `/o/{org}/p/{key}/issues` | Two sample issues, full table + filter bar |
| `05-issues-list-dark.png` | same | `data-theme=dark` via localStorage before load |

Playwright spec: `frontend/e2e/issue-list.spec.ts` (axe serious/critical = 0 on each theme).

Override output directory: `E2E_SCREENSHOTS=/path/to/dir make e2e-pr8`.

## Backend (unchanged for this slice)

Row menus and filters use existing issue APIs (`PATCH`, transitions, assign, list filters). **PR 8 backend** (additive OpenAPI) is still required before calling PR 8 complete — see progress table in `ui-redesign-plan.md`.

## Key files

```
frontend/src/components/ui/DataGrid.tsx
frontend/src/features/issues/IssueListPage.tsx
frontend/src/features/issues/IssueListTable.tsx
frontend/src/features/issues/IssueListColumnPicker.tsx
frontend/src/features/issues/issueListColumns.ts
frontend/src/features/issues/IssueListRowMenus.tsx
```
