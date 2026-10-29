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

| PR | Status |
|---|---|
| 1 Foundations | **done** — tokens (violet), Inter/JetBrains Mono, Radix primitives, toasts, theme provider, `/__design` gallery (dev only), axe light+dark in E2E. Dark mode is opt-in until PR 12 (legacy pages still use fixed light colours). |
| 2-18 | not started |

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
