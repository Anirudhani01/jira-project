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

## Phases (after PR 5a modal routing)

| Phase | Scope | Status |
|-------|--------|--------|
| **8a** | Backend: `sort` by `key`, `priority`, `status`; `label` / `sprint` filters on issue list | Done (local) |
| **8b** | Sortable headers (URL `sort`); label + sprint filters + chips; sticky header; optional Labels/Updated columns; row overflow menu; open issue in **modal** from list | Done (local) |
| **8c** | `make e2e-pr8`, journey selector updates, mark PR 8 done in master plan | Done (local) |

## Not done (out of PR 8 scope)

- `/` focus shortcut (PR 9), saved filters (PR 14)
- Full E2E journey updates (main `journey.spec.ts` still uses legacy link selectors in places)

**Depends on:** PR **5a** for list → modal open (same as board).

## Backend (8a)

- `list_sort.py` — keyset cursors for `key`, `priority`, `status` (+ existing date sorts)
- `GET /orgs/{org}/issues` — query params `sort`, `label`, `sprint` (`backlog` or sprint id)
- Tests: `test_list_sort.py`, extended `test_list_filters_combine_and_paginate_stably`

## Frontend (8b)

- `issueListSort.ts`, URL `sort`, sortable Issue / Priority / Status headers
- Label + sprint filter selects; removable filter chips (incl. non-default sort)
- Sticky `DataGridHead`, scroll container, optional **Labels** / **Updated** columns
- `IssueListRowActions` overflow menu; summary links open issue (modal when PR 5a merged)

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
