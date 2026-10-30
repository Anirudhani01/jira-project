# Project settings page (progress)

Full spec: [`ui-redesign-plan.md`](../ui-redesign-plan.md) §8d **PR 10** (tabbed settings, board column **editor**, danger zone). The route `/o/:org/p/:key` (sidebar **Settings**) is a **read-only overview** restyled ahead of PR 10.

## Done locally

| Area | Implementation |
|------|----------------|
| Page | `ProjectPage.tsx` — `PageHeader`, Kanban/Scrum badge, nav buttons to Board / Backlog / Issues, archive/unarchive (permission-gated) |
| Workflow | `ProjectWorkflowSection.tsx` — status lozenges, board column mapping in a 2-column `DataGrid`; unknown status IDs shown as `Unknown (…)` |
| Members | `ProjectMembersSection.tsx` — avatars, role badges, remove with `aria-label` including member name; typed with `UseQueryResult` pick |
| Tests | `projects.test.tsx` — workflow table, archive, permissions |

## Screenshots (`docs/ui-redesign/after/`)

Capture with a running stack (`make dev`):

```bash
make e2e-pr10-settings
```

| File | Route | Notes |
|------|--------|--------|
| `10-project-settings-light.png` | `/o/{org}/p/{key}` (Settings) | Workflow lozenges, board-column table, members |
| `10-project-settings-dark.png` | same | dark theme |

Playwright spec: `frontend/e2e/project-settings.spec.ts`.

## Not done (PR 10)

- Tabbed layout (Details / Members / Board columns / Workflow / Danger)
- Editable board columns (`PUT …/board/columns`), WIP and drag-reorder
- Org settings parity, audit filters, notification deep links

## Key files

```
frontend/src/features/projects/ProjectPage.tsx
frontend/src/features/projects/ProjectWorkflowSection.tsx
frontend/src/features/projects/ProjectMembersSection.tsx
```
