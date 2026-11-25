# Project Summary page: before and after (2026-11-25)

Evidence for a UI change: every page it touches, captured **before** the change (from the unchanged code) and **after** it, with the same script, pages, themes and widths. Data: the local demo seed (project MOBILE, a Scrum project with 6 issues).

## What changed

- A new **Summary** tab at the end of each project's tab bar (after Backlog, Board and List), opening `/o/<org>/p/<key>/summary`. It is last so the numeric keyboard shortcuts (`1` = first tab) keep their meaning.
- The page shows three headline numbers (total, done, unassigned), the split across the workflow as a thin segmented bar above a table of every status, and ranked lists of issue types and priorities. Every number links to the issue list with the same filter.
- Nothing else on the Board and List pages changed; their "after" shots only show the extra tab.

## Pages

### Board (the tab bar gains Summary)

| View | Before | After |
|---|---|---|
| Desktop (1440 px), light | [before](before/board-desktop-light.png) | [after](after/board-desktop-light.png) |
| Desktop (1440 px), paper | [before](before/board-desktop-paper.png) | [after](after/board-desktop-paper.png) |
| Desktop (1440 px), dark | [before](before/board-desktop-dark.png) | [after](after/board-desktop-dark.png) |
| Phone (375 px), light | [before](before/board-phone-light.png) | [after](after/board-phone-light.png) |
| Phone (375 px), paper | [before](before/board-phone-paper.png) | [after](after/board-phone-paper.png) |
| Phone (375 px), dark | [before](before/board-phone-dark.png) | [after](after/board-phone-dark.png) |

### List (the tab bar gains Summary)

| View | Before | After |
|---|---|---|
| Desktop (1440 px), light | [before](before/issues-desktop-light.png) | [after](after/issues-desktop-light.png) |
| Desktop (1440 px), paper | [before](before/issues-desktop-paper.png) | [after](after/issues-desktop-paper.png) |
| Desktop (1440 px), dark | [before](before/issues-desktop-dark.png) | [after](after/issues-desktop-dark.png) |
| Phone (375 px), light | [before](before/issues-phone-light.png) | [after](after/issues-phone-light.png) |
| Phone (375 px), paper | [before](before/issues-phone-paper.png) | [after](after/issues-phone-paper.png) |
| Phone (375 px), dark | [before](before/issues-phone-dark.png) | [after](after/issues-phone-dark.png) |

### Summary (new page, so there is no "before")

| View | Before | After |
|---|---|---|
| Desktop (1440 px), light | — | [after](after/summary-desktop-light.png) |
| Desktop (1440 px), paper | — | [after](after/summary-desktop-paper.png) |
| Desktop (1440 px), dark | — | [after](after/summary-desktop-dark.png) |
| Phone (375 px), light | — | [after](after/summary-phone-light.png) |
| Phone (375 px), paper | — | [after](after/summary-phone-paper.png) |
| Phone (375 px), dark | — | [after](after/summary-phone-dark.png) |

## Checks recorded for this change

| Check | Result |
|---|---|
| Responsive and accessibility sweep of the changed pages (Summary for a Scrum and a Kanban project, Board, Backlog, List) | 6 pages x 3 themes x 3 widths = 54 combinations: no horizontal overflow, no serious or critical axe violations |
| Chart colours against each theme's card surface (WCAG 1.4.11, 3:1) | Pass in all themes; lowest ratio 3.17 (paper, To do) |
| Neighbouring bar segments, normal vision (floor: delta E 15) | Light 16.8, paper 18.0, dark 17.3 |
| Neighbouring bar segments, colour-vision deficiency (target: delta E 8) | Protan/deutan (the checked axes): light 13.1, paper 14.1, dark 16.6. Tritan (rare), reported separately: light 12.0, paper 12.0, dark 5.9 (blue against green). Every colour is also named in the legend and the table, so the bar is never the only place a value appears |
| Keyboard | Tab bar, legend, table group headers, stat tiles and list rows are all links; `1`, `2`, `3` open the first three tabs |

The first colour pass found the To do grey too close to the In progress blue in the light theme (delta E 7.9 against a floor of 15), so the chart uses its own `--chart-todo`, `--chart-in-progress` and `--chart-done` tokens; the status lozenges elsewhere in the app keep their colours.
