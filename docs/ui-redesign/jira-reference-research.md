# Jira UI/UX reference research

Date: 2026-10-31. Purpose: record, with sources, how the reference product actually looks and
behaves, decide how close we go, and list the changes this implies for
[`docs/ui-redesign-plan.md`](../ui-redesign-plan.md). Everything here comes from Atlassian's
public documentation and design-system site unless marked **(general knowledge)**.

## 1. How close can we go?

| Layer | Replicate exactly? | Rule |
|---|---|---|
| **Information architecture** (what lives where: global sidebar, project tabs, board, backlog, issue view) | Yes | Functional layout is not protectable; users expect it. |
| **Interaction design** (inline edit, drag and drop, quick filters, view settings, create flow, keyboard shortcuts, command palette) | Yes | Same behaviours and the same shortcut keys. |
| **Spacing, type scale, density, elevation model** | Yes, as *our own tokens with the same proportions* | 8 px base unit, same type steps. |
| **Visual identity**: logo, name, colours, icons, illustrations, the proprietary *Atlassian Sans* font, marketing copy | **No** | Trade dress and brand assets. We keep our own violet palette, Inter, lucide icons and wordmark. |

Result: someone who knows the reference product should be able to use ours without learning
anything, while the two are not mistaken for each other. If you want a closer *visual* match
than this, the safe route is a different colour accent only; copying the brand colours, logo or
font is not something we should do.

## 2. Findings

### 2.1 Navigation (current generation)
Source: [What is the new navigation in Jira?](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-new-navigation-in-jira/),
[Old vs new navigation](https://support.atlassian.com/navigation/docs/old-vs-new-navigation-in-jira/).

- A **left global sidebar** holds the essentials in this order: **For you, Recent, Starred**,
  then **Spaces/Projects** (expandable), then other items such as **Dashboards** (and Filters),
  then **More** and **Customize sidebar**. Brand/app switcher sits at the top.
- The **top bar** carries **Search** and **Create** (primary), then **AI chat, Notifications,
  Settings, Account** at the right.
- **Project navigation moved from a project sidebar to horizontal tabs under the top bar**
  (Summary, Timeline, Backlog, Board, List, Forms, Calendar, ... configurable by admins:
  reorder/remove tabs for the whole team). Project settings live in a **More actions (•••)**
  menu next to the project name.
- The sidebar is **collapsible** (hide-sidebar icon, shortcut **Ctrl + [**); customisation is
  per user (show/hide/reorder, also by keyboard).
- Boards can be **starred** to appear under Starred.
- **Full-screen mode** on board/backlog hides the global nav and sidebar.

### 2.2 Board and backlog
Source: [Customize your view of the board and backlog](https://support.atlassian.com/jira-software-cloud/docs/customize-your-view-of-the-board-and-backlog/).

- **View settings** (top right, per user): *Open work items in sidebar* (on = right-side panel,
  off = centred dialog), *Quick filters* as buttons, *Fields* toggles for card content (work
  type, key, epic, linked items, priority, assignee, card cover, due date, labels), *Swimlanes*
  expand/collapse all, *Group by* (swimlanes), optional extra card fields.
- **Backlog view settings**: *Version panel* (key **V**), *Epic panel* (key **E**), quick filters,
  **Density: Default or Compact**, field toggles (type, key, version, epic, status, priority,
  assignee, due date), swimlane expand/collapse (subtasks).
- Board shortcuts: **N** next column, **P** previous column, toggle all swimlanes.
- Cards: type icon, key, summary, priority, assignee avatar, epic chip, labels; **+ Create** in
  a column foot; search box and quick filters (assignee avatars, "recently updated") above.
  **(general knowledge)** Sprint header shows name, dates and a **Complete sprint** button;
  column headers show counts and WIP limit state.

### 2.3 Issue ("work item") view
Sources: [Configure the work item details](https://support.atlassian.com/jira-software-cloud/docs/configure-the-issue-detail-view/),
[Update a work item's details](https://support.atlassian.com/jira-software-cloud/docs/update-a-work-items-details/),
[work item view redesign post](https://community.atlassian.com/forums/Jira-articles/A-clearer-more-focused-Jira-work-item-view-is-coming/ba-p/3262002).

- **Two columns**: description and content on the left; context fields (Assignee, Reporter,
  Labels, ...) in a **right-hand details panel**; "Show more" reveals fields hidden until set.
- **Inline editing**: click the field, edit, it saves with no Save button.
- A redesign adds inline **child and linked work item** sections, a **unified activity history**
  (comments and updates together), per-user **pinning/reordering of fields**, and unified
  attachments.
- Opens as a **sidebar panel or centred dialog from boards** (setting above) and as a full page
  by URL. **(general knowledge)** Header: breadcrumb with type icon and key, title, a **status
  button** that opens the allowed transitions, quick actions (watch, share, more menu).

### 2.4 Keyboard and command palette
Sources: [Use keyboard shortcuts](https://support.atlassian.com/jira-software-cloud/docs/use-keyboard-shortcuts/),
[What is the command palette?](https://support.atlassian.com/jira-software-cloud/docs/what-is-the-command-palette/).

- **?** (Shift + /) opens the shortcuts dialog; shortcuts can be switched off there.
- **C** create; **O** open; **A** assign; **I** assign to me; **M** comment; **J/K** next/previous
  item; **N/P** next/previous column; **V** version panel, **E** epic panel (backlog);
  **Ctrl + [** collapse sidebar.
- **Cmd/Ctrl + K** command palette: searches commands; typing **/** filters to work items,
  spaces, boards and filters; commands show their own shortcut; a chevron means the palette stays
  open after the action; it does not open while typing in a field. Numeric shortcuts (e.g. **1**)
  jump to space tabs.

### 2.5 Design-system foundations (the proportions to copy)
Sources: [Spacing](https://atlassian.design/foundations/spacing),
[Typography](https://atlassian.design/foundations/typography),
[Elevation](https://atlassian.design/foundations/elevation),
[Design tokens](https://atlassian.design/foundations/design-tokens).

- **Spacing**: 8 px base; tokens 0, 2, 4, 6, **8**, 12, **16**, 20, **24**, 32, 40, 48, 64, 80 px.
  Small (0-8) inside components, medium (12-24) between elements, large (32-80) between sections.
- **Type**: headings bold, 32/36, 28/32, 24/28, 20/24, 16/20, 14/20, 12/16 (size/line-height);
  body **14/20** default, 16/24 large, 12/16 small; code 12/20; metric 28/32, 24/28, 16/20.
- **Elevation**: four levels (sunken, default, raised, overlay) plus overflow; raised and overlay
  always carry a shadow.
- **Tokens and theming**: semantic colour roles (text, link, icon, background, border, blanket,
  chart, skeleton), light, dark and high-contrast themes from one token set.

## 3. Gap analysis (today's merged UI vs reference)

| Area | Reference | Ours today | Gap |
|---|---|---|---|
| Global nav | Left global sidebar (For you, Recent, Starred, Projects, Dashboards, More) + top bar (Search, Create, notifications, settings, account) | Top bar + **project** sidebar (the previous-generation layout) | Different model. See decision A. |
| Project nav | **Horizontal tabs** under the top bar, admin-configurable | Sidebar links | Add tabs (Summary, Backlog, Board, List, Reports, Settings). |
| Starred / Recent / For you | Yes | None | New (small backend: stars, recents). |
| Board controls | View settings menu, quick filters, group by, density, full screen | Basic toolbar | Add View settings and group by. |
| Card fields | Per-user field toggles | Fixed | Add toggles. |
| Backlog | Version/epic panels (V/E), density, field toggles | Panels, rows | Add epic panel, density, toggles. |
| Issue view | Right-side panel or dialog setting, details panel, pinned fields, inline edit, unified history | Modal + page, two columns, tabs | Mostly there; add side-panel mode, pinning, "Show more". |
| Shortcuts | C O A I M J K N P V E ? Ctrl+[ | None yet (PR 9) | Use exactly these keys. |
| Command palette | Cmd/Ctrl+K with "/" filter and chevron behaviour | None yet (PR 9) | Match behaviour. |
| Spacing/type | 8 px grid, 14/20 body | Tailwind defaults + our tokens | Align scale (tokens). |
| Density | Compact option | None | Add. |

## 4. Decisions needed (they change the plan)

- **A. Navigation model.** Current Jira uses *global sidebar + project tabs*; we built the older
  *project sidebar* (PR 2, merged). Options: **(1) keep it**, **(2) move to the current model**
  (recommended if you want "max as is": global sidebar with For you / Recent / Starred /
  Projects, project tabs, "More actions" menu). Cost: one extra PR, re-testing the shell.
- **B. Visual closeness.** Keep our violet identity (recommended; see section 1), or choose a
  different accent. Brand colours, logo and font are out of scope.
- **C. Fidelity source.** The public docs describe behaviour but not pixel details. For pixel
  accuracy we need reference screenshots of the screens to match (board, backlog, issue view,
  create dialog, command palette, notifications, project settings). Please provide screenshots
  from a Jira site you have access to; we then match layout, spacing and density to them.

## 5. Amendments to the delivery plan (pending your answers to A and C)

| New/changed PR | Change |
|---|---|
| **2b Navigation v2** (if A=2) | Global sidebar (For you, Recent, Starred, Projects, Dashboards, More, Customize), top bar (Search, Create, notifications, settings, account), project **tabs** with "More actions", collapse with Ctrl+[, full-screen mode. Backend: `stars` and recents endpoints. |
| **4b Board view settings** | View settings menu (field toggles, quick filters as buttons, open in side panel vs dialog, density), Group by, N/P column keys, full screen. |
| **5b Issue view parity** | Side-panel mode, "Show more" hidden-empty fields, per-user pinned/reordered fields, unified history. |
| **7 Backlog (extended)** | Epic panel (E), version panel (V, later), compact density, field toggles, sprint header parity. |
| **9 Palette and shortcuts (exact keys)** | Keys exactly as in 2.4; palette behaviour exactly as in 2.4. |
| **12 QA** | Add "compare against reference screenshots" checklist per screen. |

Everything else in the plan (PRs 6, 8, 10, 11, 13-18) stands unchanged.
