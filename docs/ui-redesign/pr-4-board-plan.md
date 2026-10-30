# PR 4 — Board UI plan

Reference: [Jira board patterns](https://www.atlassian.com/software/jira/guides/boards/overview) — status columns, dense cards (key, summary, type, priority, labels, assignee), quick filters above the board, WIP limits with visual emphasis when exceeded ([column constraints](https://support.atlassian.com/jira-software-cloud/docs/configure-columns/)).

## Jira → our mapping (no Atlassian assets)

| Jira pattern | Our implementation |
|--------------|-------------------|
| Card layout (type, key, summary, epic, extras) | `IssueCard` + `TypeIcon`, `PriorityIcon`, label chips, parent chip, `Avatar` |
| Quick filters bar | `BoardQuickFilters` — `q`, assignee avatars (toggle), **Only my issues**, type/label selects, **Clear**; synced to URL |
| Column header count + WIP | `BoardColumnHeader` + `WipBar`; server `count` / `over_wip_limit` (filters hide cards but WIP reflects loaded column totals, like Jira) |
| Drag between columns + overlay | `@dnd-kit` `DragOverlay`, column ring highlight, invalid columns dimmed (existing `allowedColumnIds`) |
| Open issue from card | Key + summary are one **link** to `/o/{org}/issues/{KEY}`; **drag listeners only on the grip handle** (not the whole card) so clicks navigate reliably |
| Move via ⋮ menu | Radix `DropdownMenu` replaces native `<select>`; **Open issue** in menu |
| Scrum sprint banner | `BoardSprintHeader` — name, dates, goal, days left; **Complete sprint** dialog via `useCompleteSprint` + backlog fetch for `SprintResponse` |
| + Create in column | Footer button → `CreateIssueDialog` (same as issue list until PR 6 modal shortcuts) |
| Empty / loading | `BoardSkeleton`, per-column dashed empty, scrum “no active sprint” `EmptyState` |

## Files

- `boardFilters.ts` + tests — parse/serialize URL, `matchesBoardFilters`, `collectBoardFilterMeta`
- `IssueCard.tsx` — presentation + grip-only drag + linked title + overflow menu
- `BoardColumn.tsx` — droppable column, header, list, create footer
- `BoardQuickFilters.tsx` — toolbar
- `BoardSprintHeader.tsx` — scrum chrome + complete dialog
- `BoardSkeleton.tsx` — loading placeholder
- `BoardPage.tsx` — compose, `DragOverlay`, filtered view
- `board.test.tsx` — update for menu move; filter unit tests
- `e2e/board.spec.ts` — assignee filter, menu move, keyboard drag, axe
- `journey.spec.ts` — menu move labels
- `Makefile` — `e2e-pr4` → `06-board-{light,dark}.png` in `docs/ui-redesign/after/`

## Out of scope

- Comment count (not on `IssueResponse`)
- Swimlanes (PR 13)
- Server-side board filtering
