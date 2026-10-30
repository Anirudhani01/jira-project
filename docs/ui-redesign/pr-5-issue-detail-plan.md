# PR 5 — Issue detail (progress)

Full spec: [`ui-redesign-plan.md`](../ui-redesign-plan.md) §8d PR 5. Delivery is **phased**; complete each phase before the next.

## Phases

| Phase | Scope | Status |
|-------|--------|--------|
| **5a** | Modal-over-context routing (board + issue list + backlog); full page on direct `/o/:org/issues/:key`; `Esc` / close returns to background; delete closes modal | **Done (local)** — covered in `issue-detail.spec.ts`, `issueDetailNavigation.test.ts` |
| **5b** | Two-column layout; status as primary control; field save + **412** reload banner + toast; delete confirm dialog | **Done (local)** |
| **5c** | Activity tabs (All / Comments / History); Markdown description toolbar + preview; child table + **done/total** progress (backend additive on `GET …/children`) | **Done (local)** |
| **5d** | Component + E2E (modal from board: edit, comment, Esc); axe light/dark; screenshots `07-issue-detail-{light,dark}.png` | **Done (local)** — `make e2e-pr5`, `issue-detail.spec.ts`, `issueDetailSections.test.tsx` |

## Done locally (before 5a)

| Area | Implementation |
|------|----------------|
| Full-page detail | `IssueDetailPage` — inline summary/description, shared row menus, comments, If-Match / 412 on summary |
| Row menus | `IssueListRowMenus.tsx` reused on detail |
| Tests | `issues.test.tsx` — conflict, transitions, field patches |

## Depends on

- PR 2 app shell (done)
- PR 4 board (done) — card links open detail

## Key files (5a)

```
frontend/src/app/MainOutlet.tsx
frontend/src/app/AppShell.tsx
frontend/src/features/issues/issueDetailNavigation.ts
frontend/src/features/issues/IssueDetailModal.tsx
frontend/src/features/issues/IssueDetailPage.tsx
frontend/src/app/routes.tsx
frontend/src/features/board/IssueCard.tsx
frontend/src/features/issues/IssueListTable.tsx
frontend/src/features/backlog/BacklogPage.tsx
frontend/e2e/issue-detail.spec.ts
frontend/src/features/issues/issueDetailNavigation.test.ts
frontend/src/features/issues/issueDetailSections.test.tsx
```

## 5d QA

```bash
make dev   # in another terminal
make e2e-pr5
# → docs/ui-redesign/after/07-issue-detail-light.png
# → docs/ui-redesign/after/07-issue-detail-dark.png
```

Override output: `E2E_SCREENSHOTS=/path/to/dir make e2e-pr5`.

## 5a behaviour

- **`issueDetailLinkProps`** — board, list, backlog, and in-modal parent/child links pass `state.backgroundLocation`.
- **`issueDetailLinkContext`** — nested issue links keep the original board/list URL as background.
- **`MainOutlet`** — `useRoutes(..., backgroundLocation)` + `IssueDetailModal` when modal state is set.

## Backend (5c only)

Additive `done` / `total` on `GET /orgs/{org}/issues/{key}/children` — see master plan §8d PR 5.
