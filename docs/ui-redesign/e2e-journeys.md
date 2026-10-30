# E2E — MVP user journey suite (PLAN §1.2)

Scenario bodies live in **`frontend/e2e/suites/mvp/scenarios.ts`**. Playwright registers them in **`frontend/e2e/suites/mvp-journeys.suite.spec.ts`**.

| Tag | Meaning |
|-----|---------|
| `@mvp` | Full suite |
| `@mvp-smoke` | Fast subset for local/optional CI (`01-signup-org`, `07-kanban-board`) |
| `@journey-NN` | All scenarios for PLAN journey *NN* |
| `@scenario-<id>` | One scenario (e.g. `@scenario-03-kanban`, `@scenario-05-subtask-labels`) |

| PLAN | Scenario id | Title |
|------|-------------|--------|
| 1 | `01-signup-org` | sign up, verify, org, empty projects |
| 2 | `02-invitation` | invite + accept |
| 3 | `03-kanban` | Kanban board + settings |
| 3 | `03-scrum` | Scrum backlog + board |
| 4 | `04-project-members` | add member via API, list on project settings |
| 5 | `05-create-full` | create with type, priority, assignee |
| 5 | `05-create-shortcut` | list dialog shortcut |
| 5 | `05-subtask-labels` | parent, sub-task, label on parent |
| 6 | `06-issue-detail` | edit, assign, transition, comment, activity |
| 7 | `07-kanban-board` | move columns, keyboard drag, filter (within-column rank: `board.spec.ts`) |
| 8 | `08-scrum-sprint` | backlog, sprint start/complete |
| 9 | `09-search-notify` | search + assignment notification |
| 10 | `10-audit-account` | audit, sessions revoke-other, password change |

Shared helpers: **`frontend/e2e/helpers.ts`** (`bootstrapKanbanProject`, `projectMembersSection`, Mailpit newest-first, `e2eProjectKey`, etc.).

Screenshot specs (`board.spec.ts`, `issue-list.spec.ts`, …) use the same bootstrap helpers as the suite.

## Known gaps (acceptable / documented)

- **Journey 4:** Project “add member” UI not in app yet — `addProjectMemberViaApi` until settings exposes invite.
- **Journey 9:** Assignment notification only; comment/status notification flows are not duplicated here (same pattern as assign + second user).
- **Rank / drag:** Within-column keyboard reorder is in **`07-kanban-board`**; pointer drag is also exercised in **`board.spec.ts`**.

## CI

**`make ci` does not run Playwright.** E2E expects a live stack (`make dev`: API, worker, Vite, Mailpit). Run locally:

```bash
make dev
make e2e-journeys          # full @mvp (serial, ~15–25 min)
make e2e-journeys-smoke    # @mvp-smoke only
make e2e                   # chromium specs + MVP suite
```

Optional filters:

```bash
cd frontend && pnpm e2e:journeys --grep @journey-05
cd frontend && pnpm e2e:journeys --grep @scenario-08-scrum-sprint
```

`e2e/journey.spec.ts` remains a single **smoke** path across several steps; detailed coverage is only in the suite registry.
