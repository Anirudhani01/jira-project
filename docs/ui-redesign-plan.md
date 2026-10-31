# UI redesign plan

Status: **APPROVED — Option C (full parity), violet accent, dark mode in scope.** Section 0 is the contract; the rest is the reasoning behind it.
Date: 2026-10-30. Screenshots of today's UI are in `docs/ui-redesign/before/`.

## 0. Final decisions (the contract)

| # | Decision |
|---|---|
| 1 | **Scope: Option C, full parity** — all rows of section 8 (PRs 1-12) plus the Option-C additions in section 8b (PRs 13-18). |
| 2 | **Accent colour: violet.** Light `#6a45d6`, dark `#b69cff` (both meet 4.5:1 text contrast on their surfaces); hover/soft variants derived from them. The epic issue type moves to magenta `#b4308a` so epics stay distinguishable from the accent. Everything else neutral. |
| 3 | **Dark mode: yes**, light / dark / system, shipped in PR 1. |
| 4 | **Primitives: Radix UI + our own wrapper components**, `lucide-react` icons, Inter + JetBrains Mono (self-hosted), Radix Toast (not sonner: sonner injects a `<style>` tag, which the production CSP `style-src 'self'` blocks). |
| 5 | **Product name/logo:** keep "Jira Project" as a placeholder wordmark; never use Atlassian marks, icons, fonts or copy. |
| 6 | **Compatibility rule:** existing routes and API contracts do not change (except the additive endpoints listed in section 6); the existing E2E journey and unit tests are updated, never deleted. |
| 7 | **Quality gate on every PR:** lint, typecheck, unit tests, `make e2e`, axe (serious/critical = 0) on every touched route, before/after screenshots, light and dark. |
| 8 | **Delivery:** one PR per row below, merged in order; each PR is shippable on its own. |

## 1. Why: what is wrong today

The product works, but the interface is a functional skeleton. Findings from the live screens
(board, backlog, issue list, issue detail, org home, auth):

| Area | Problem | Evidence |
|---|---|---|
| Navigation | One thin top bar. No project sidebar, no breadcrumbs outside the issue page, no way to hop between Board / Backlog / Issues / Settings except page-level text links. | `03-org-home`, `06-board` |
| Visual system | No design tokens: default Tailwind greys and one blue, system font, no icons, no logo, no dark mode, no consistent spacing/radius/elevation. Every page re-invents its own headings and links. | `src/index.css` is one line |
| Board cards | Text only. No issue-type icon, priority marker, assignee avatar, labels, or epic colour, so cards cannot be scanned. Every card shows a native `<select>` for moving, which dominates the card. | `06-board` |
| Board chrome | No filters (assignee, type, label, text), no swimlanes, no column header actions, no WIP highlight beyond a count, no empty-column affordance. Columns stop at the content height. | `06-board` |
| Backlog | Plain rows with a native select per row; no issue-type/priority/assignee/estimate columns, no sprint dates or goal, no progress bar, no multi-select, no inline "create issue" per section. | `07-backlog` |
| Issue page | One long column of "Edit x" text links. Nothing is edited in place; fields are not grouped; description, activity and comments are not tabbed; no side panel for people/dates/labels. Looks like a form, not a work item. | `08-issue` |
| Issue list | Hairline table with native filters; no column headers, sorting, saved filters, bulk actions or avatars. | `05-issues` |
| Controls | Every dropdown is a native `<select>`; no combobox with search/avatars, no popovers, tooltips, toasts, skeleton loaders or proper empty states. | all |
| Forms and auth | Correct but bare: left-aligned narrow form on an empty page, no branding, no password-strength or show/hide, no illustration. | `02-login` |
| Responsive | Fixed max-width layout; no mobile navigation, boards do not collapse sensibly. | — |
| Accessibility | Good base (labels, axe clean on board/audit, keyboard drag + "Move to" menu). Must be preserved, not regressed, by the redesign. | `e2e/journey.spec.ts` |

Conclusion: the gap is **information design and a missing design system**, not missing features.

## 2. What the reference product does (public UX patterns)

We reproduce well-understood *interaction patterns* of mainstream issue trackers. We do **not**
copy Atlassian's logo, name, icons, fonts, colours or marketing copy; the product gets its own
visual identity (section 3).

1. **Global top bar**: product switcher/logo, project switcher, a prominent **Create** button,
   global search, notifications, help, profile menu.
2. **Project sidebar**: project avatar + name, then *Board / Backlog / Issues / Reports* and
   *Project settings*; collapsible; remembers state.
3. **Board**: column headers with count and WIP; **quick filters** (search box, assignee avatar
   stack, "only my issues", "recently updated", label/type filters); optional **swimlanes**
   (by assignee / epic); dense **cards** with summary, type icon, key, priority icon, labels,
   assignee avatar, story points; drag with a placeholder and drop highlighting; "+ Create" at
   the bottom of a column; end-of-sprint banner with **Complete sprint**.
4. **Backlog**: collapsible **sprint panels** (name, dates, goal, issue/point counts, status
   count badges, Start/Complete button) above a **Backlog** panel; rows with type, key, summary,
   epic chip, assignee, priority, estimate; multi-select; drag between panels; inline
   "Create issue" at the bottom of each panel.
5. **Issue view**: opens as a **modal over the board** (and as a full page by URL). Two columns:
   left = title (inline-editable), description (rich, click to edit), child issues, linked
   work, **Activity** tabs (All / Comments / History); right = **status button** with
   transition menu, assignee, reporter, labels, parent/epic, sprint, priority, dates. Every field
   is edited in place and saved on blur, with a toast on conflict.
6. **Create issue**: modal with project + type first, summary, description, assignee, labels;
   "Create another" checkbox; keyboard shortcut **C**.
7. **Search and filters**: a search that accepts text or a key, plus a filter bar with chips and
   a "Save filter" action; results as a list or board.
8. **Keyboard**: `C` create, `/` search, `?` shortcut help, `G` then `B/L/I` to go to
   board/backlog/issues, `J/K` move in lists, `E` edit, `M` comment.
9. **Empty states and onboarding**: every empty screen explains itself and offers the next
   action ("Plan your first sprint").
10. **Feedback**: toasts for success/failure, optimistic updates with rollback, skeleton
    loading, inline validation.

## 3. Visual identity and design system (ours)

- **Look**: calm, dense, "work tool" — neutral surfaces, one confident **violet** accent, semantic
  colours for status/priority, 8 px grid, 6–8 px radii, soft elevation only on overlays.
- **Tokens** (CSS variables in `src/index.css`, mapped into Tailwind v4 `@theme`):
  colour roles (surface, surface-raised, border, text, text-muted, accent, danger, warning,
  success, plus status-category and priority scales), type scale (12/13/14/16/20/24/32),
  spacing, radius, shadow, z-index, motion (150 ms ease-out, `prefers-reduced-motion` aware).
- **Dark mode**: light/dark/system, token-driven, stored per user (localStorage + `prefers-color-scheme`).
- **Typeface**: Inter (self-hosted, variable) for UI; JetBrains Mono for keys/code.
- **Icons**: `lucide-react` (open licence): issue types (Epic, Story, Task, Bug, Sub-task),
  priorities (chevrons), status, nav.
- **Primitives**: Radix UI (unstyled, accessible) wrapped in our own components — Dialog, Popover,
  DropdownMenu, Tooltip, Tabs, Select/Combobox (cmdk), Avatar, Toast (sonner), Checkbox,
  Switch. Rationale: accessibility is already a requirement (WCAG 2.2 AA); Radix gives focus
  management and ARIA for free and keeps our tests valid.
- **Components we build on top**: `Button`, `IconButton`, `Input`, `Textarea`, `Field`,
  `Badge/Lozenge` (status category), `TypeIcon`, `PriorityIcon`, `Avatar/AvatarStack`,
  `Card`, `EmptyState`, `Skeleton`, `PageHeader`, `Toolbar`, `FilterChip`, `Breadcrumbs`,
  `KeyboardShortcut`, `CommandPalette`.
- **Docs**: a `/__design` route (dev only) rendering every component and state, used for visual QA.

## 4. Information architecture and shell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ▣ logo  Projects ▾   [ + Create ]        🔍 Search…        🔔  ?  (avatar)│  top bar
├────────────┬─────────────────────────────────────────────────────────────┤
│ ◼ SHOT     │  Projects / Website / Board                                 │
│  Website   │  ┌─ Sprint 1 · 12 Nov – 26 Nov ──── Complete sprint ───────┐│
│ ─────────  │  │ 🔍 filter  ◉◉◉ assignees  Only mine  Recently updated  ││
│ Board      │  └─────────────────────────────────────────────────────────┘│
│ Backlog    │  To do 4 │ In progress 2/3 │ In review 0 │ Done 5            │
│ Issues     │  ▢ cards … ▢ …                                              │
│ Settings   │                                                              │
└────────────┴─────────────────────────────────────────────────────────────┘
```
- Routes stay the same (`/o/:org/p/:key/{board,backlog,issues}`), so bookmarks and the E2E
  suite keep working. The shell gains: project sidebar, breadcrumbs, command palette (`⌘K`),
  org/project switcher, responsive collapse (sidebar becomes a drawer under 1024 px).
- Issue detail becomes a **route-driven modal** over board/backlog/list (`/o/:org/issues/KEY`
  still works standalone).

## 5. Screen-by-screen redesign

1. **Auth (sign in / up / reset)**: split layout (form + short product panel), password
   show/hide + strength meter, clear error states. No behaviour change.
2. **Org home / project list**: project cards (avatar, key, type, last activity, open issues),
   "Create project" empty state with templates (Kanban, Scrum).
3. **Board**: rich cards (type icon, key, summary, priority, labels, assignee avatar, sprint
   chip when relevant), quick-filter toolbar, column header with WIP bar and "+ Create",
   drag overlay and drop highlighting, swimlanes (assignee / none), "Move to" kept as an
   overflow menu item (accessibility), sprint header with dates, goal, days left, *Complete
   sprint* dialog (choose where open issues go).
4. **Backlog**: collapsible sprint panels with header stats, count lozenges per status
   category, row grid (type, key, summary, assignee, priority, status), inline create, drag
   between panels with drop zones, multi-select with bulk move, "Create sprint".
5. **Issue detail (modal + page)**: two-column layout described in section 2.5; inline edit
   for every field; status button with transitions; assignee/labels comboboxes with avatars;
   activity tabs (All / Comments / History) with relative times; comment composer with
   Markdown toolbar and preview; child issues table with progress.
6. **Issue list**: sortable table with column picker, filter chips, saved filters, bulk actions
   (assign, move to sprint, delete), pagination/infinite scroll with sticky header.
7. **Create issue**: modal with type chooser, rich description, "create another", `C` shortcut.
8. **Notifications**: popover with grouped (today/earlier), unread dot, per-item icons, "mark all
   read", deep link to the issue (and comment).
9. **Project settings / members / board columns / workflow**: tabbed settings; board column
   editor with drag-reorder, WIP inputs and status mapping chips.
10. **Org settings, members, audit log**: consistent table component, filters as chips,
    export-free (read-only) audit with metadata expansion.
11. **Search / command palette**: `⌘K` jumps to projects, issues by key/text, and actions.
12. **Empty/error/loading**: skeletons for every list, illustrated empty states, retry-able
    error panels, offline banner.

## 6. What needs backend work (the rest is frontend only)

| Feature | Needs |
|---|---|
| Avatars | None (initials + deterministic colour client-side). Optional later: profile images (file storage). |
| Story points / estimates | New nullable `story_points` column on issues + field in create/update + sprint totals. |
| Epic colour / epic chip | Optional `color` on epics (tiny migration). |
| Swimlanes by assignee/epic | None for assignee (client grouping); epic grouping needs `parent` already returned. |
| Quick filters on board | Optional server filter params on the board endpoint (assignee/label/q) to avoid sending 500 cards; client-side filtering first. |
| Saved filters | New `saved_filters` table + 4 endpoints. |
| Bulk actions | `POST /issues/bulk` (assign / move to sprint / delete) with per-item results. |
| Relative "recently updated" | Already available (`updated_at`). |
| Comment deep links | None. |
| Child-issue progress | Aggregate counts on the children endpoint. |
| Rich-text editor | Markdown stays (already sanitised server-side); toolbar + preview only. |

## 7. Options — pick one

| | **A. Polish** | **B. Jira-class core** (recommended) | **C. Full parity** |
|---|---|---|---|
| Design system, tokens, dark mode, icons, shell, sidebar, breadcrumbs | ✔ | ✔ | ✔ |
| Auth, org home, lists restyled | ✔ | ✔ | ✔ |
| Rich board cards + quick filters + sprint header | ✔ | ✔ | ✔ |
| Backlog panels with columns, inline create, multi-select | basic | ✔ | ✔ |
| Issue modal with inline editing, two-column layout, activity tabs | basic page | ✔ | ✔ |
| Comboboxes (assignee, labels, parent), toasts, skeletons, empty states | ✔ | ✔ | ✔ |
| Command palette, keyboard shortcuts | — | ✔ | ✔ |
| Swimlanes, story points, saved filters, bulk actions | — | story points | ✔ all |
| Reports (burndown, velocity), roadmap/timeline | — | — | ✔ |
| Backend changes | none | small (points) | moderate |
| Size (PRs) | ~6 | ~12 | ~20+ |

Recommendation: **B**, delivered in the order below so each step is usable on its own.

## 8. Delivery plan (for B; A is steps 1–4, C adds 9–12)

| # | PR | Contents | Verified by |
|---|---|---|---|
| 1 | Foundations | tokens, Inter + mono fonts, Radix/lucide/sonner deps, primitives, `/__design` page, dark mode | unit tests, axe on `/__design`, screenshots |
| 2 | Shell | top bar, project sidebar, breadcrumbs, responsive drawer, org/project switcher | E2E nav test, axe |
| 3 | Auth + org home + project list | restyled pages, empty states, skeletons | existing tests updated, screenshots |
| 4 | Board | rich cards, toolbar filters, headers, drag overlay, sprint header, complete-sprint dialog | component tests, E2E (card menu + keyboard drag), axe |
| 5 | Issue detail | modal route + page, two columns, inline edit, status button, activity tabs, comment composer | component tests incl. 412 conflict toast |
| 6 | Create issue + comboboxes | create modal, assignee/labels/parent comboboxes, "create another", `C` | tests, E2E |
| 7 | Backlog | panels, row grid, inline create, multi-select, bulk move | tests, E2E |
| 8 | Issue list + search | table, sort, filter chips, column picker | tests |
| 9 | Command palette + shortcuts | `⌘K`, `C`, `/`, `G B`… with help dialog | tests |
| 10 | Notifications + settings + audit | popover, tabbed settings, board-column editor | tests, axe |
| 11 | Story points | migration, API, UI, sprint totals | backend + UI tests |
| 12 | Responsive + visual QA | mobile layouts, screenshot baseline in CI, a11y sweep | Playwright screenshots, axe on every route |

Rules for every PR: keep existing routes and API contracts; no regression in axe (serious/
critical) or keyboard access; update unit tests and the E2E journey; attach before/after
screenshots; `make lint test` stays green.

## 8b. Option-C additions (after PR 12)

| # | PR | Contents | Backend |
|---|---|---|---|
| 13 | Swimlanes | board grouped by assignee or epic, collapsible lanes | none |
| 14 | Saved filters | filter chips persisted per user, shown in the sidebar | `saved_filters` table + 4 endpoints |
| 15 | Bulk actions | multi-select in list/backlog: assign, move to sprint, delete | `POST /issues/bulk` |
| 16 | Sprint reports | burndown, velocity, sprint report page | report endpoints over activity data |
| 17 | Roadmap/timeline | epic timeline by sprint/date | none (uses sprint dates, epics) |
| 18 | Final QA | full screenshot baseline in CI, a11y and performance budget sweep, docs | none |

## 8c. Progress

| PR | UI status | Backend | Notes |
|---|---|---|---|
| 1 Foundations | **Done (#31)** — tokens (violet), fonts, Radix primitives, toasts, theme provider, `/__design` (dev), axe E2E light+dark | **OK — none needed** | Dark mode is opt-in until PR 12; product pages still use legacy light markup until later PRs. |
| 2b Navigation v2 | **Done (this PR)** — global sidebar (For you, Recent, Starred, Projects, More, Customize sidebar), project header + tabs (Backlog, Board, List) with Star and More actions, `Ctrl+[` collapse; recents/starred/customisation kept per user in the browser (server-side stars later). Old org sidebar, project sidebar and breadcrumbs removed. | **OK — none** | Decisions: violet kept, no reference screenshots (see `ui-redesign/jira-reference-research.md` §4 once merged). |
| 2 App shell | **Done (#33)** — top bar, sidebar, breadcrumbs, drawer; legacy org `<select>` removed | **OK — none** | Screenshots: add to `docs/ui-redesign/after/` before merge. |
| 3 Auth + org home + account | **Done** — `AuthLayout`, templates, account; **org home dashboard** (tabs, project cards, sidebar, global search) on PR #38 | **OK — none** | Supersedes simple project-card org home. Screenshots: `03-org-home-*`, `org-dashboard-m*.png`. |
| 4 Board | **Done** — PR 4 behaviour + **M1–M5 board shell** (blue chrome, in-page header, columns, cards, mobile overflow) on PR #38 | **OK — none** | [`pr-4-board-plan.md`](ui-redesign/pr-4-board-plan.md); `06-board-*`, `mobile-scrum-board-m*.png`. |
| 5 Issue detail | **Done (local)** — modal + page, two-column, activity tabs, markdown, child progress; `make e2e-pr5` → `07-issue-detail-*` | **Done (local)** — children `done`/`total` on `GET …/children` | Phased plan: [`pr-5-issue-detail-plan.md`](ui-redesign/pr-5-issue-detail-plan.md). |
| 6 Create issue + comboboxes | **Pending** — modal, cmdk comboboxes, idempotency | **OK — none** | Members, labels, issues search already exist. |
| 7 Backlog | **Pending** — panels, row grid, multi-select, drag | **OK — none** | Sprint/backlog mutations already exist. |
| 8 Issue list + search | **Done (local, PR 8)** — server sort (`key`, `priority`, `status`), `label`/`sprint` filters, sortable headers + chips, sticky table, Labels/Updated columns, row overflow menu | — | Progress + screenshots: [`pr-8-issue-list-plan.md`](ui-redesign/pr-8-issue-list-plan.md) (`make e2e-pr8` → `05-issues-list-{light,dark}.png`). |
| 9 Command palette + shortcuts | **Pending** — `⌘K`, `C`, `/`, `G B/L/I`, help dialog | **OK — none** | |
| 10 Notifications + settings + audit | **Partial (local)** — project **Settings** route restyled (workflow read-only table, members list, archive); notifications/audit/org settings still legacy | **Needed (PR 10)** — additive `comment_id` on `issue_commented` notification payload | Settings progress + screenshots: [`pr-project-settings-plan.md`](ui-redesign/pr-project-settings-plan.md) (`make e2e-pr10-settings` → `10-project-settings-{light,dark}.png`). |
| 11 Story points | **Pending** — estimate on create/detail/board/backlog | **Needed (PR 11)** — migration `issues.story_points`, create/update/activity, sprint `points_total` / `points_done` | Not in backend yet. |
| 12 Responsive + visual QA | **Pending** — breakpoints, system theme default, screenshot CI | **OK — none** | Depends on 3–11 UI complete. |
| 13 Swimlanes | **Pending** — group by assignee/epic (view only) | **OK — none** | Client grouping. |
| 14 Saved filters | **Pending** — save/apply filters per user | **Needed (PR 14)** — `saved_filters` table + CRUD endpoints | Not in backend yet. |
| 15 Bulk actions | **Pending** — assign / sprint / priority / delete bar | **Needed (PR 15)** — `POST …/issues/bulk` with per-item results | Not in backend yet. |
| 16 Sprint reports | **Pending** — burndown, velocity, sprint report | **Needed (PR 16)** — report/burndown/velocity read endpoints | Derived from activity + sprints; no new tables. |
| 17 Roadmap / timeline | **Pending** — epic timeline view | **Needed (PR 17)** — `GET …/roadmap` aggregation | Not in backend yet. |
| 18 Final QA + release | **Pending** — CI screenshots, docs, cross-browser | **OK — none** | After 13–17. |

**Backend today (before UI PRs 5+):** API, auth, board, backlog, sprints, notifications (M11), search column (M12), retention role, etc. are in place for local/prod — **no backend blockers for starting PR 2–4, 6, 7, or 9**. Server work is **scoped to the PRs marked “Needed” above** (additive fields/endpoints only; contract in section 0 unchanged).

Full build/test specs for each UI PR: section 8d.

**Incremental plan docs** (local work not yet merged as full PRs):

- [`docs/ui-redesign/pr-4-board-plan.md`](ui-redesign/pr-4-board-plan.md)
- [`docs/ui-redesign/pr-5-issue-detail-plan.md`](ui-redesign/pr-5-issue-detail-plan.md)
- [`docs/ui-redesign/pr-8-issue-list-plan.md`](ui-redesign/pr-8-issue-list-plan.md)
- [`docs/ui-redesign/pr-project-settings-plan.md`](ui-redesign/pr-project-settings-plan.md)

## 8d. PR-by-PR specification (PRs 2-18)

Every PR obeys the contract in section 0 (existing routes/API contracts kept, lint + typecheck +
unit + `make e2e` green, axe serious/critical = 0 in light **and** dark, before/after
screenshots in `docs/ui-redesign/after/`, plan progress table updated). "Backend" lists the only
server changes a PR may make; everything else is frontend. Each PR ends with the legacy markup
it replaced deleted, so no page keeps two styles.

### PR 2 — App shell
- **Goal:** one consistent frame for every signed-in page.
- **Build:** top bar (wordmark, project switcher popover, **Create** button, search trigger,
  notifications popover slot, theme toggle, profile menu with Account / Sign out); project
  sidebar (project avatar+key, **Board / Backlog / Issues / Settings**, collapsible, state
  remembered in localStorage); breadcrumbs from the route; mobile (< 1024 px) sidebar becomes a
  drawer; skip-link and landmark roles kept. Replaces `AppShell.tsx` and the org switcher
  `<select>`.
- **Behaviour:** sidebar shows only for `/o/:org/p/:key/*`; Backlog link only for scrum
  projects; current page marked `aria-current="page"`; project switcher lists projects the user
  can view (existing `GET /orgs/{org}/projects`).
- **Tests:** component tests for sidebar visibility/active state/collapse persistence/drawer;
  E2E: navigate Board → Backlog → Issues via the sidebar with the keyboard only; axe on shell.
- **Backend:** none. **Depends on:** 1.

### PR 3 — Auth, org home, project list, account
- **Build:** auth pages in a split layout (form + short product panel), password show/hide and
  strength hint (client-side length/charset only; the server remains the authority); org home as
  project cards (avatar, key, name, board type, open-issue count if cheap, last activity) with an
  empty state and **Create project** card; create-org/create-project/accept-invite/account/
  sessions pages restyled with the new `Field`/`Button`; all `LoadingState`/`ErrorState` become
  skeletons and the shared error panel with retry and request id.
- **Tests:** existing auth/org/project/account tests updated (labels unchanged); axe on each
  route; E2E signup→verify→login unchanged.
- **Backend:** none (open-issue count only if already derivable from existing list calls;
  otherwise omitted). **Depends on:** 2.

### PR 4 — Board
- **Build:** rich `IssueCard` (type icon, key in mono, summary clamp 2 lines, priority icon,
  labels as chips, assignee avatar, parent/epic chip, comment count if available), column
  header (name, count, WIP `n / limit` bar turning warning/danger), `+ Create` at column foot,
  quick-filter toolbar (search box, assignee avatar stack toggles, **Only my issues**, type and
  label filters, **Clear**; filters in the URL and applied client-side to the ≤500 loaded
  cards), dnd-kit drag overlay + drop highlighting + invalid-column dimming (existing logic),
  drag handle as a real button (keeps the axe fix), "Move to…" in a card overflow menu,
  sprint header for scrum (name, dates, goal, days left, **Complete sprint** dialog reusing the
  backlog mutation), empty-column and no-active-sprint empty states, skeleton while loading.
- **Tests:** card/column/filter component tests; optimistic rollback test kept; E2E: filter by
  assignee, move via menu, keyboard drag (focus handle, Space, arrows, Space) asserting the new
  column; axe on board.
- **Backend:** none. **Depends on:** 2.

### PR 5 — Issue detail (modal route + page)
- **Build:** route-driven **modal over board/backlog/list** (background-location pattern) and the
  same component as a full page at `/o/:org/issues/:key`. Two columns: left — inline-editable
  title, Markdown description (click to edit, preview toggle, Save/Cancel, `Esc` cancels),
  child-issues table with progress bar, **Activity** tabs (All / Comments / History) with
  relative times and a comment composer (Markdown toolbar: bold, italic, code, list, link;
  preview); right — **status button** (menu of allowed transitions only), assignee, reporter,
  labels, parent/epic, sprint, priority, type, created/updated. Every field saves on blur/select
  with `If-Match`; **412** shows a toast "Updated by someone else" plus **Reload** that refetches
  and keeps the user's draft; delete lives in the overflow menu with a confirm dialog.
- **Tests:** component tests per field (edit, cancel, save, 412 conflict, validation error);
  E2E: open from board in a modal, edit summary + priority, comment, close with `Esc`, deep
  link loads the page form; axe on modal and page.
- **Backend:** child-issue counts — add `done`/`total` to `GET /issues/{key}/children`
  response (additive). **Depends on:** 2, 4.

### PR 6 — Create issue and comboboxes
- **Build:** shared **Combobox** (cmdk-based: type to filter, avatars/icons, keyboard, clear)
  used for assignee (project members), labels (multi, create-on-type for admins), parent/epic
  (search epics/stories), sprint; **Create issue** modal: project, type chooser (icons), summary,
  description, assignee, labels, parent, sprint, "Create another", Idempotency-Key per submit;
  opened by the top-bar **Create** button, column `+ Create`, backlog inline create and the
  `C` shortcut (PR 9 wires the shortcut). Sub-task requires a parent (existing rule) with a
  clear inline message.
- **Tests:** combobox unit tests (filter, keyboard, multi, clear, a11y name); create flow incl.
  idempotent retry and sub-task parent rule; E2E create from the top bar.
- **Backend:** none (uses members/labels/issues endpoints). **Depends on:** 2, 5.

### PR 7 — Backlog
- **Build:** collapsible sprint panels (name, dates, goal, issue count, status-category count
  lozenges, **Start / Complete / Edit / Delete** in a menu), row grid (drag handle, type, key,
  summary, epic chip, labels, assignee avatar, priority, status lozenge), **inline create** at the
  foot of each panel, multi-select (checkbox column, shift-range) with a floating bar **Move to
  sprint / Backlog**, drag between panels with drop highlighting (existing mutation), start-sprint
  dialog (dates default to today + 2 weeks) and complete-sprint dialog (target selector, open
  issue count), create-sprint button, empty states per panel.
- **Tests:** panel/row/selection component tests; E2E: create sprint, add two issues by drag
  and by menu, start, complete to backlog; axe.
- **Backend:** none. **Depends on:** 4, 6.

### PR 8 — Issue list and search
- **Build:** sortable table (key, type, summary, status, priority, assignee, labels, updated)
  with sticky header, column picker (persisted), filter bar of chips (status category, type,
  priority, assignee, label, sprint, text; chips removable; **Clear all**), result count,
  infinite scroll/"Load more", row actions menu, empty state with suggestion to clear filters;
  `q` search box with `/` focus (shortcut in PR 9).
- **Tests:** table sort/filter/column-picker component tests; E2E: filter + search + open issue.
- **Backend:** `sort` already supported for `updated_at`/`created_at`; add `key`, `priority`,
  `status` sort and a `label` filter param to `GET /issues` (additive, tested, openapi
  regenerated). **Depends on:** 5.

### PR 9 — Command palette and shortcuts
- **Build:** `⌘K / Ctrl+K` palette (cmdk): jump to projects, open issue by key, text search
  results, actions (Create issue, Go to board/backlog/issues, Toggle theme, Sign out);
  global shortcuts `C`, `/`, `?`, `G B`, `G L`, `G I`, `J/K` in lists, `E` edit, `M` comment;
  **Shortcut help** dialog; shortcuts disabled while typing in inputs and when a modal is open;
  every shortcut also reachable by menu (no keyboard-only features).
- **Tests:** hook tests for the key map and the "ignore while typing" guard; E2E: open palette,
  go to an issue, `C` opens create.
- **Backend:** none. **Depends on:** 2, 6, 8.

### PR 10 — Notifications, settings, members, audit
- **Build:** notifications popover (grouped Today/Earlier, per-type icons, unread dot, **Mark
  all read**, deep link to the issue and comment, empty state, polling kept); project settings
  as tabs (Details, Members, Board columns, Workflow read-only, Danger zone) with a **board
  column editor** (drag-reorder, rename, WIP input, status chips mapped to columns, validation
  "every status in exactly one column"); org settings and members (invite dialog, role menu,
  remove with confirm); audit log with filter chips, metadata expansion row, load more.
- **Tests:** component tests for editor validation and notification grouping; E2E: edit a
  column name/WIP and see it on the board; axe on every touched route.
- **Backend:** notification payload gains `comment_id` for deep links (additive field on
  `issue_commented`). **Depends on:** 2, 5.

### PR 11 — Story points
- **Build:** estimate field on create/detail/backlog rows/board cards; sprint panel and
  board header show committed and completed points; quick-edit in the backlog row.
- **Backend:** migration — nullable `issues.story_points smallint` (CHECK 0..100); added to
  create/update/response schemas, activity (`story_points` field change), `version` bump like
  other fields; sprint response gains `points_total` and `points_done`; backlog/board responses
  carry it via `IssueResponse`. Tests: validation bounds, activity, RLS unchanged, sprint
  totals, migration round trip, openapi drift. **Depends on:** 7.

### PR 12 — Responsive, theme default, visual QA
- **Build:** every route usable at 360 / 768 / 1280 px (board scrolls horizontally with
  sticky headers, tables become cards on small screens, modals full-screen on mobile); flip the
  theme default from light to **system** (all legacy colour classes are gone by now — add a
  lint rule/test that forbids `slate-`/`blue-` palette classes and raw hex in `src/`); Playwright
  **screenshot baseline** (light + dark × key routes) stored under `e2e/__screenshots__`,
  compared in `make e2e`; performance budget (initial JS ≤ 250 kB gzip via route-level
  `lazy()`), reduced-motion check.
- **Tests:** the new lint/guard test, screenshot specs, axe sweep over every route.
- **Backend:** none. **Depends on:** 3-11.

### PR 13 — Swimlanes
- **Build:** board **Group by** menu: None / Assignee / Epic; collapsible lanes with counts;
  unassigned/no-epic lane last; works with filters and drag (moving between lanes does not
  change assignee/epic — lanes are a view only, stated in the UI).
- **Tests:** grouping function unit tests; E2E: group by assignee, collapse a lane.
- **Backend:** none. **Depends on:** 4, 12.

### PR 14 — Saved filters
- **Build:** "Save filter" on list/board toolbar (name, personal), saved filters listed in the
  sidebar under **Filters**, rename/delete, applying one sets the URL params.
- **Backend:** migration `saved_filters(id, org_id, project_id, owner_id, name, params jsonb,
  created_at)` with RLS (owner-only), composite FKs, unique `(owner_id, project_id, name)`;
  endpoints `GET/POST /projects/{key}/filters`, `PATCH/DELETE /filters/{id}`; `params` validated
  against an allow-list of keys/values (no free-form SQL/JSON). Tests: own-only RLS, validation,
  limits (50 per user per project), openapi. **Depends on:** 8, 12.

### PR 15 — Bulk actions
- **Build:** multi-select on list and backlog with a bar: **Assign, Move to sprint, Change
  priority, Delete**; confirmation with item count; per-item result summary ("18 updated, 2
  failed — see why").
- **Backend:** `POST /orgs/{org}/issues/bulk` `{keys[≤100], action, value}` runs each item in
  its own transaction with the normal permission/version/archived checks and returns per-item
  results (never all-or-nothing); one audit event per call (`issue.bulk` with counts). Tests:
  mixed success/failure, permission per item, limit, idempotent replay via `Idempotency-Key`.
  **Depends on:** 7, 8.

### PR 16 — Sprint reports
- **Build:** **Reports** sidebar item: Sprint report (committed vs completed, added after start,
  removed, carried over), **Burndown** (issues and points, ideal line, scope-change markers),
  **Velocity** (last 6 closed sprints, committed vs completed); charts as accessible SVG with a
  data table alternative; follows the dataviz guidance (colour-blind safe, tooltips, legend).
- **Backend:** `GET /sprints/{id}/report`, `GET /sprints/{id}/burndown`, `GET
  /projects/{key}/velocity?sprints=6`, all derived from `issue_activity` (status transitions,
  `sprint_changed`, `story_points`) and sprint dates — no new tables. Tests: golden datasets
  for add/remove/complete mid-sprint, empty sprint, points vs count. **Depends on:** 11.

### PR 17 — Roadmap / timeline
- **Build:** **Roadmap** sidebar item: epics as bars across a sprint/month timeline (start =
  first child's sprint start, end = last sprint end), progress fill (done/total), expand to
  children, zoom (sprints / months), today marker, keyboard navigable rows.
- **Backend:** `GET /projects/{key}/roadmap` (epics with child counts, done counts, sprint
  span); no new tables. Tests: span/aggregation cases, access control. **Depends on:** 11, 16.

### PR 18 — Final QA and release
- **Build:** screenshot baseline in CI (GitHub Actions job running the stack + `make e2e`,
  allowed to be required once green for a week), full axe sweep, performance and bundle
  budget check, cross-browser smoke (Chromium + Firefox + WebKit) on the E2E journey, docs
  (`README` screenshots, `docs/ui-guide.md` with component rules), delete `/__design` from
  production routes (already dev-only), final decision-record entry.
- **Backend:** none. **Depends on:** 13-17.

### Order and parallelism
Strict order 2 → 3; then 4 and 5 can proceed in parallel after 2; 6 after 5; 7 after 4+6;
8 after 5; 9 after 6+8; 10 after 5; 11 after 7; 12 after 3-11; 13-17 after 12 (13/14/15 are
independent; 16 → 17); 18 last.

## 9. Decisions (resolved — see section 0)

These were the open questions; the answers are recorded in section 0:

1. **Option**: **C** (section 7).
2. **Visual direction**: **violet accent** on neutral surfaces. Product name/logo: placeholder
   "Jira Project" (we must not use Atlassian's marks).
3. **Dark mode** in scope now (recommended) or later.
4. **Primitives**: Radix + our own wrappers (recommended) or a ready kit (e.g. shadcn/ui on
   Radix, same dependency, faster start, more files to own).
5. **Reports** (burndown/velocity) and **roadmap**: now (C) or after B.
6. **Branch/PR style**: one PR per row of section 8, merged in order.

## 10. Risks

- Scope creep toward "clone every feature": mitigated by fixed options and the PR table.
- Accessibility regressions from custom widgets: use Radix, keep axe in the E2E suite.
- Visual drift between pages: all styling goes through tokens and the shared components.
- Bundle size: lazy-load the board, backlog and editor routes; budget 250 kB gzip initial.
