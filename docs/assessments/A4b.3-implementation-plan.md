# A4b.3 — Project Workflow Editor (implementation plan)

**Status:** Planning only — **no product code until approved**
**Depends on:** A4b.2 (approved) — `PUT /workflow`, `revision`, `ReplaceWorkflowRequest`, CSRF + `If-Match: "w{n}"`
**Worktree:** `jira-project-a4b-workflow-editing`
**Branch:** `feat/org-workflow-admin-a4b`
**Assessment:** `A4b.0-workflow-editing-security-architecture.md` (U3: project tab primary; hub read-only)
**Last updated:** 2026-11-01 — final plan details (board columns, Columns tab, `status_in_use`)

---

## 1. Existing frontend architecture and reuse

### 1.1 Verified entry points

| Area | File | Today |
|------|------|--------|
| Project settings shell | `frontend/src/features/projects/ProjectPage.tsx` | Tabs: details, members, **columns**, **workflow**, danger. `canManage = permissions.includes('project.manage')` used for archive only; workflow tab does **not** receive `canManage` yet. |
| Workflow read UI | `frontend/src/features/projects/ProjectWorkflowSection.tsx` | Card + `DataGrid` tables for statuses, transitions, board columns; hard-coded **Read-only** badge. |
| Board column editor (reference) | `frontend/src/features/projects/BoardColumnsEditor.tsx` + `boardColumnsModel.ts` | Draft/save/discard, dnd-kit reorder, inline validation, `useReplaceBoardColumns`, offline + permission gates, toast on success. |
| Workflow fetch | `frontend/src/features/projects/api.ts` | `useWorkflow(org, key)` → GET `/orgs/{org}/projects/{key}/workflow`. **No PUT mutation yet.** |
| Board fetch (column ids + WIP) | `frontend/src/features/board/api.ts` | `useBoard(org, key)` → columns include **`id`**, **`wip_limit`**. |
| Admin hub | `frontend/src/features/admin/pages/AdminWorkflowHubPage.tsx` | Expand-only read-only inspect; reuses `ProjectWorkflowSection`. **Must stay read-only (U3).** |
| Display helpers | `frontend/src/features/projects/workflowDisplay.ts` | Category labels, status name resolution for transitions. |
| HTTP client | `frontend/src/lib/api/client.ts` | CSRF on unsafe methods; `apiFetch` throws `ApiError`. |
| Types | `frontend/src/lib/api/types.ts` | `Workflow = WorkflowResponse` from generated `schema.d.ts`. |
| Conflict precedent | `frontend/src/features/issues/IssueDetailPage.tsx` + `issues.test.tsx` | On **412**: keep draft, banner, **Reload latest**; no silent overwrite. |
| Error UX | `frontend/src/lib/ux/mapApiErrorToUxState.ts`, `permissionDeniedInlineMessage` | 412 → conflict; 403/404 mapped for inline copy. |
| Design system | `components/ui/*` (Card, Button, Input, Badge, DataGrid, FormError, Toast, Overlay/Dialog patterns used elsewhere) | Navy/fg tokens, compact SaaS layout. |

### 1.2 API contract (A4b.2 — verified in `backend/openapi.json`)

- **GET** `/api/v1/orgs/{org_slug}/projects/{project_key}/workflow` → `WorkflowResponse`:
  - `name`, `initial_status_id`, **`revision`**, `statuses[]`, `transitions[]`, `columns[]`
  - `ColumnResponse`: **`name`, `position`, `status_ids` only** (no column `id`, no WIP).
- **PUT** same path → body **`ReplaceWorkflowRequest`** (required: `name`, `initial_status_id`, `statuses`, `transitions`, `columns`; optional `status_remaps[]`).
  - Each `columns[]` entry is **`ColumnInput`** (OpenAPI): required `name`, `status_ids`; optional **`id`** (uuid | null), optional **`wip_limit`** (integer 1–1000 | null).
  - Headers: **`If-Match: "w{revision}"`**, **`X-CSRF-Token`** (via existing session CSRF).
  - Response: updated `WorkflowResponse` with incremented `revision` on successful mutation.
- **Backend (verified):** `boards/column_mapping.validate_column_mapping` passes `wip_limit` into `boards/repository.replace_columns`, which upserts `BoardColumn.wip_limit` by column **id**. Workflow PUT and board `PUT .../board/columns` share this path for column writes inside A4b.2.

**Frontend types gap (verified):** `frontend/src/lib/api/schema.d.ts` is **stale** — missing `revision` on `WorkflowResponse` and **no PUT operation / `ReplaceWorkflowRequest`**. Regeneration is step zero of implementation (§7).

**Board GET (verified):** `useBoard` → `GET .../board` returns `BoardResponse.columns[]` with **`id`**, **`name`**, **`position`**, **`wip_limit`**, **`status_ids`**, plus issue counts (not needed for editing).

### 1.3 Permissions (no new frontend permission)

| Capability | Permission string | UI gate |
|------------|-------------------|---------|
| View workflow tab | `project.view` | Tab visible when project loads (existing). |
| Edit workflow | **`project.manage`** | Editor controls, Save/Discard (matches A4b.0 / A4b.2 `ManageProject`). |
| Board columns tab | **`project.manage`** (see §4) | **No independent save** when user can edit workflow; read-only preview + link to Workflow tab. |

**Verified:** In `permissions.py`, `board.manage` is only granted together with `project.manage` (`_PROJECT_ALL` for org owner/admin and project admin). There is no project role with `board.manage` alone. All users who could save on the Columns tab today also have `project.manage`.

Org owner/admin receive `project.manage` on all projects via API; project admin on assigned projects only. Members/viewers: read-only presentation.

**Archived project:** Match danger zone / issue rules — workflow tab **read-only** when `project.archived === true` (no PUT), even if permissions include manage.

---

## 2. Proposed editor layout and interaction flow

### 2.1 High-level layout (single page, project Workflow tab)

Replace the always-read-only card with a **mode split** inside `ProjectWorkflowSection` (or a thin wrapper `ProjectWorkflowPanel`):

```
┌─────────────────────────────────────────────────────────────┐
│ Workflow name [Input]                    [Discard] [Save]   │
│ Subtitle: project key · name · revision w{n} (muted)        │
│ [Conflict banner if 412]  [FormError / validation summary]  │
├─────────────────────────────────────────────────────────────┤
│ § Statuses (ordered list)                                   │
│   Add status · drag reorder · name · category · initial     │
│   radio · edit · delete (confirm + remap when needed)         │
├─────────────────────────────────────────────────────────────┤
│ § Transitions (explicit rows only)                          │
│   Add transition · name · from (incl. “Any”) · to · delete  │
├─────────────────────────────────────────────────────────────┤
│ § Board columns (bundled mapping; same save as graph)       │
│   Reuse `boardColumnsModel` patterns: names, order, WIP,    │
│   status assignment (every status exactly once)             │
└─────────────────────────────────────────────────────────────┘
```

**Read-only mode** (no `project.manage`, archived, or offline): retain current table presentation; show **“View only”** for non-managers and **“Editing disabled”** when archived/offline.

### 2.2 Interaction flow

1. **Load (editors):** **`useWorkflow` + `useBoard`** in parallel before showing the editor (column **ids** and **wip_limit** come from board; status mapping order/names from workflow GET — see §4).
2. **Initialize draft:** `workflowEditorModel.fromServer(workflow, board)` (§4).
3. **Edit:** Local draft only until Save; **no optimistic server state**.
4. **Validate client-side** where cheap (§6.3); server remains authoritative.
5. **Save:** Single **`PUT .../workflow`** with full `ReplaceWorkflowRequest` and `If-Match: "w{baseline.revision}"` — **the only mutation path** for graph + column mapping (+ WIP on columns).
6. **Success:** Toast; baseline ← response + refetched board; cache invalidation (§4.4).
7. **Discard:** Reset draft from baseline snapshot.
8. **Navigation guard:** `beforeunload` + `useBlocker` when draft is dirty.

### 2.3 Destructive status deletion (draft-only until save)

1. User **Delete** on a status → confirm dialog (name + consequences).
2. On confirm: remove status from draft statuses; remove from transitions; remove from column `status_ids`; if it was initial, require a new initial in draft before save (client validation).
3. **Optional proactive remap:** Dialog may include an optional “If issues use this status, move them to…” select (targets remaining statuses). If chosen, add `{ from_status_id, to_status_id }` to draft `status_remaps` immediately. If omitted, omit remap until/unless server returns **`status_in_use`** (§6.4).
4. **No issue-list/count API** and no pre-save issue probe in v1.
5. **No automatic transition generation** (U6).

### 2.4 Admin Hub

- **No edit controls**, no PUT from hub.
- Optional (non-blocking): link “Edit in project settings” → `/o/{slug}/p/{key}?tab=workflow` for users with manage (hub already org-manage gated; project manage may still differ — link is convenience only).

---

## 3. API integration and request payload design

### 3.1 New API hook

Add to `frontend/src/features/projects/api.ts`:

```ts
export type ReplaceWorkflowBody = components['schemas']['ReplaceWorkflowRequest'];

export function useReplaceWorkflow(org: string, projectKey: string) {
  return useMutation({
    mutationFn: ({ body, revision }: { body: ReplaceWorkflowBody; revision: number }) =>
      apiFetch<Workflow>(`${projectPath(org, projectKey)}/workflow`, {
        method: 'PUT',
        json: body,
        headers: { 'If-Match': `"w${String(revision)}"` },
      }),
    onSuccess: () => {
      // invalidate workflow, board, projects list as needed
    },
  });
}
```

Export related input types from `schema.d.ts` (`StatusInput`, `TransitionInput`, `StatusRemapInput`, `ColumnInput`) via `types.ts` aliases.

### 3.2 Draft model module (new)

**File:** `frontend/src/features/projects/workflowEditorModel.ts`

Responsibilities:

| Function | Purpose |
|----------|---------|
| `fromServer(workflow, board)` | Build `WorkflowDraft`; columns via **signature(`status_ids`)** + board `id` (§4.3). |
| `isDirty(draft, baseline)` | Deep compare normalized snapshot. |
| `validate(draft)` | Client validation → field errors + form-level message. |
| `toReplaceWorkflowRequest(draft)` | Full PUT body: existing ids preserved; **new** statuses/transitions use **`crypto.randomUUID()`**; `id: null` omitted per OpenAPI optional uuid. |
| `applyReload(draft, serverWorkflow, board)` | Used after user clicks Reload on 412 — refresh baseline only; draft unchanged until Discard. |

**Statuses:** `position` derived from list order (0…n) on save.
**Transitions:** Explicit list only; `from_status_id: null` = “Any status” (matches read UI).
**status_remaps:** Include only entries for statuses removed in this draft that require remap (see delete flow).
**name:** Workflow name from top-level input.

### 3.3 No frontend-only contract

- Do not PATCH individual statuses or split graph writes.
- Do **not** call `PUT .../board/columns` from the Workflow tab Save action (bundled `columns[]` on workflow PUT only — §4.3).

---

## 4. Board-column identity, WIP, and the Columns tab

### 4.1 WIP limits on workflow PUT (verified)

| Question | Answer |
|----------|--------|
| Does `ReplaceWorkflowRequest.columns[]` support WIP? | **Yes.** Each item is `ColumnInput` with optional `wip_limit` (`openapi.json`; same schema as `ReplaceColumnsRequest.columns[]`). |
| Does A4b.2 apply WIP on workflow save? | **Yes.** `validate_column_mapping` returns `(column_id, name, wip_limit, status_ids)`; `replace_columns` writes `wip_limit` on insert/update. |
| Frontend action | Workflow editor **includes WIP fields** in the board-columns section and sends current draft `wip_limit` values on workflow PUT. **Do not omit WIP** (that would overwrite with null unless explicitly cleared). |

No additional backend work is required for WIP on the workflow path.

### 4.2 Column identity — not array index

**Primary identity in the editor draft** is:

| Field | Role |
|-------|------|
| **`id`** (optional uuid) | Persisted board column id from `GET .../board`. Required on PUT for every row that existed on load. |
| **`clientKey`** (string) | Stable React/draft key: use **`id`** when present, else generated once per new row (same pattern as `BoardColumnsEditor`’s `uid`). |

**Do not** use workflow `ColumnResponse.position` or PUT array index as identity. Array order only defines **new board position** on save (`replace_columns` enumerates the list); **ids move with rows** when the user reorders.

### 4.3 Bootstrapping draft columns (`fromServer`)

Inputs: `WorkflowResponse` + `BoardResponse`.

1. **Signature function:** `columnSignature(status_ids: string[]) = sorted(status_ids).join('\0')` (empty string = empty column).
2. **Index board columns by signature** → `{ signature → BoardColumn }`. If two board columns share the same signature (should not happen when valid), treat as load error / refetch.
3. **Build ordered row list** from **`board.columns` sorted by `board.columns[].position`** (authoritative row count and ids). For each board column, set draft `status_ids` from the **workflow** column with the **same signature** if one exists; else use **board.column.status_ids** (board is source of truth for ids when sets differ — user must fix in editor before save).
4. **Workflow-only column entries** (signature present in workflow GET but no board column): append as draft rows **without `id`** (new column); `clientKey = newClientKey()`; name from workflow column; `wip_limit = null` until user sets.
5. **Board-only columns** (on board, signature not in workflow): keep row with board `id` and **empty or board `status_ids`**; user must assign statuses before save (client validation: every status exactly once).

**Matching rule:** **`status_ids` set equality (signature)** links workflow mapping to board rows — **not** position, not name alone. Names and WIP always come from the **board** row when `id` is known; editable in draft.

### 4.4 Serialization (`toReplaceWorkflowRequest`)

Emit `columns` as an **ordered array** (draft list order = new positions):

```ts
columns: draft.columns.map((row) => ({
  ...(row.id ? { id: row.id } : {}),
  name: row.name.trim(),
  wip_limit: row.wipEmpty ? null : row.wipNumber,
  status_ids: row.status_ids,
}))
```

| Case | `id` in PUT | Backend behavior (verified) |
|------|-------------|-----------------------------|
| Existing column | **Required** known uuid from board | UPDATE row by id; position = index in array |
| New column | **Omitted** | `validate_column_mapping` assigns `uuid4()`; INSERT |
| Removed column | Row dropped from array | `existing - keep` → DELETE board column |
| Reordered | Same ids, different array order | UPDATE positions only; **id stays with row** |
| Status moved between columns | Same column ids; `status_ids` arrays updated | Mapping rewrite via `board_column_statuses` |
| Status remap on delete | `status_remaps` + updated `status_ids` | Issues updated in TX; columns rewritten |

**Remapped issues:** No change to column **id**; remove deleted status uuid from one column’s `status_ids`, ensure it appears on the replacement column’s `status_ids` (and in `status_remaps` for the deleted id).

### 4.5 Columns tab — single canonical mutation path

**Problem:** Today `BoardColumnsEditor` saves via **`PUT .../board/columns`** without workflow `If-Match`, while A4b.2 writes columns inside **`PUT .../workflow`**. Two saves can overwrite the same configuration.

**Decision (A4b.3):**

| User | Columns tab | Workflow tab |
|------|-------------|--------------|
| **`project.manage`** (all current column editors) | **Read-only** preview: reuse table/layout from `BoardColumnsEditor` in **`canManage={false}`** mode **or** a slim `BoardColumnsReadOnly` extracted from it. Show callout: *“Edit workflow, statuses, transitions, and column mapping on the **Workflow** tab.”* **No Save button**; no `useReplaceBoardColumns` from this tab. | **Only** save path: full editor + **`useReplaceWorkflow`**. |
| **View only** (`project.view` only) | Read-only (same as today visually). | Read-only. |

**Reuse:** Embed **`boardColumnsModel`** (`validateColumns`, `assignStatus`, `moveColumn`, WIP parsing) inside the Workflow tab column section — shared with the read-only Columns tab display where possible. **Do not** maintain two independent editable drafts.

**Deprecate for editors:** `useReplaceBoardColumns` remains in codebase for tests/legacy reference but **is not invoked** from project settings UI when `project.manage` is present (i.e. all former column editors). Standalone board PUT remains on the backend for API compatibility; frontend project settings no longer uses it in A4b.3.

### 4.6 Query cache invalidation after successful workflow save

On **`useReplaceWorkflow` success** (mirror breadth of today’s column save):

1. **`await queryClient.invalidateQueries({ queryKey: [...projectKey(org, key), 'workflow'] })`**
2. **`await queryClient.invalidateQueries({ queryKey: boardKey(org, key) })`** — `['org', org, 'board', PROJECT]` per `board/api.ts`
3. **`await queryClient.invalidateQueries({ queryKey: ['org', org.toLowerCase()] })`** — same broad invalidation as `useReplaceBoardColumns` (board views, issues, transitions that depend on graph)
4. **Refetch** workflow + board before resetting baseline (or use PUT response for workflow + explicit board refetch so Columns read-only tab updates immediately)
5. **Do not** bump `revision` locally except from server response body

Optional: `queryClient.setQueryData` for workflow from PUT response to avoid flicker; still invalidate board.

---

## 5. Permission and read-only behavior

| State | UI |
|-------|-----|
| `project.view` only | Tables + “View only” helper text; no inputs/buttons Save. |
| `project.manage` + active project | Full editor. |
| `project.manage` + archived | Read-only tables + archived explanation (match `ProjectPage` danger copy). |
| Offline (`useAppOnline`) | Disable Save; status message (pattern from `BoardColumnsEditor`). |
| 403 on PUT | `permissionDeniedInlineMessage` — no retry loop that mutates. |
| 404 on GET/PUT | Project `NotFoundPage` / workflow error state (non-member). |

Do **not** use `org.manage` or `board.manage` to show workflow edit controls.

---

## 6. Conflict and validation UX

### 6.1 HTTP mapping (workflow-specific copy where helpful)

| Status | Code(s) | UI behavior |
|--------|---------|-------------|
| **412** | `workflow_revision_conflict` | **Keep draft.** Banner: “Someone else updated this workflow. Your changes were not saved.” Actions: **Reload latest** (refetch workflow + board, update baseline, keep draft until Discard) and **Discard my changes** (reset draft to new baseline). **Do not** auto-merge server graph into draft. **Do not** bump local revision or mark saved. |
| **428** | `precondition_required` | Treat as client bug if `If-Match` omitted; show generic error + support id. |
| **403** | `forbidden` | Inline permission message; draft preserved. |
| **404** | `not_found` | Error state / not found; no local revision bump. |
| **422** | `status_name_taken` | Highlight status name field(s); message from API; **draft preserved**. |
| | `status_in_use` | **§6.4** — draft preserved; guided remap UI; user re-saves same PUT. |
| | `invalid_workflow` / `invalid_board_columns` | Map `errors[].field` to sections (statuses / transitions / columns); **draft preserved**. |
| | `project_archived` | Toast + refetch project; disable editor. |
| **Network** | `network_error` | Toast + retry Save; draft preserved; saving spinner off. |

Reuse **`mapApiErrorToUxState`** for 412 conflict title/description baseline; workflow banner text can extend issue-detail wording (“workflow” instead of “issue”).

### 6.2 Save lifecycle UX

- **Save in progress:** Primary button `Saving…`, disable Discard and destructive actions.
- **Save success:** Toast; update baseline + revision from response body (not optimistic increment).
- **No-op save:** Backend returns 200 same revision — still refresh baseline from response (handles concurrent no-op).

### 6.3 Inline validation (client)

- Duplicate status names (casefold).
- Empty workflow name / status / transition names.
- Initial status must exist and not be deleted.
- Transition `to_status_id` required; `from` optional.
- Columns: reuse `validateColumns` rules (unmapped statuses, WIP numeric, max 20 columns).
- Deleting last status blocked client-side.

Server remains authoritative; client validation reduces round trips.

### 6.4 `status_in_use` — exact UI behavior (no new APIs)

**Trigger:** `PUT .../workflow` returns **422** with `code: "status_in_use"` (status removed in payload but issues still reference it and **`status_remaps`** lacks a valid entry for that id).

**Requirements:**

1. **Preserve the full workflow draft** — no reset, no navigation away, no “Reload latest” unless the user explicitly chooses that from a separate 412 banner.
2. **Show a focused remediation block** (inline alert or dialog) above Save:
   - Title: e.g. “Issues still use a removed status”
   - Body: API `detail` (e.g. “Provide status_remaps for statuses that still have issues.”)
   - For each **removed status id** still in the draft’s “pending delete” set without a remap: a **required** `<select>` “Move issues to” listing **remaining** status ids/names in the draft (exclude the deleted id; exclude self).
3. **Primary action:** “Apply remapping” (or “Update draft”) — writes `{ from_status_id, to_status_id }` into draft `status_remaps`, updates column `status_ids` if needed (replacement column gains the uuid for any unassigned edge cases), **does not** call the server yet.
4. **Secondary:** Cancel alert only (dismiss); draft unchanged except user may re-add status manually via Discard.
5. **User clicks Save again** — same complete graph + updated `status_remaps` + `If-Match: "w{baseline.revision}"` (revision unchanged since prior save failed).
6. **Validation errors** from other 422 codes behave the same: **draft kept**, field-level messages; user fixes and re-saves.

**Delete dialog (proactive, optional):** May offer the same “Move issues to” select before first Save to reduce `status_in_use` round trips; not required if server check is the source of truth.

**Out of scope:** Issue-count endpoints, issue-list prefetch, backend changes, synthetic `issue_activity`.

---

## 7. Component and browser test plan

### 7.1 OpenAPI / types (implementation step 0)

From repo root (requires `pnpm install` in frontend worktree):

```bash
make openapi   # export_openapi + pnpm gen:api
make openapi-check
```

Adds `revision`, `ReplaceWorkflowRequest`, PUT operation to `schema.d.ts`. Extend `frontend/src/lib/api/types.ts` with exported request/input aliases. **Do not hand-edit generated schema except via regeneration.**

### 7.2 Vitest component / integration tests

| File | Tests |
|------|--------|
| `workflowEditorModel.test.ts` | `fromServer` signature/id merge; reorder preserves ids; new column omits id; `toReplaceWorkflowRequest` includes `wip_limit`; remaps on delete. |
| `projects.test.tsx` (extend) | Viewer: no Save; manager: edit name + save mock PUT with `If-Match: "w1"`; read-only badge behavior. |
| `workflowEditor.test.tsx` (new) | Status delete; **422 `status_in_use`** → remap UI → second Save sends `status_remaps`; 412 keeps draft; Columns tab no Save when `project.manage`. |
| `boardColumnsModel.test.ts` | No change required unless extracting shared helpers — optional shared `assignStatus` tests if moved. |

Mock API via existing `test/api.ts` (`mockApi`, `problem()`), matching `issues.test.tsx` 412 patterns.

**Fixtures:** Update `WORKFLOW` / `A4A_WORKFLOW` to include **`revision: 1`** everywhere.

### 7.3 Playwright E2E

| Spec | Coverage |
|------|----------|
| Extend `e2e/project-settings.spec.ts` | Workflow tab Save + PUT; **Columns tab: no Save** for manager; column WIP/name edit only on Workflow tab; viewer read-only. |
| **New** `e2e/workflow-edit.spec.ts` | End-to-end: add status, assign column, add transition, save; delete status with remap; **412 path** via mock second PUT failure; axe + screenshots. |
| `e2e/admin-workflow.spec.ts` | Assert hub still **no** Save/textboxes on workflow expand. |

**Responsive:** Run workflow-edit journey at **390×844** and desktop (reuse `board-demo-mobile.spec.ts` / `helpers.ts` viewport patterns).

### 7.4 Manual / CI verification

- `pnpm test`, `pnpm typecheck`, `pnpm lint`
- `make ci` path includes `openapi-check` + frontend tests
- Optional: add `@mvp-smoke` tag on one workflow-edit scenario if journey suite needs it (follow existing e2e tagging conventions)

---

## 8. Exact proposed files to change

| Path | Action |
|------|--------|
| `frontend/src/lib/api/schema.d.ts` | **Regenerate** (`pnpm gen:api`) |
| `frontend/src/lib/api/types.ts` | Add `ReplaceWorkflowRequest`, input type aliases |
| `frontend/src/features/projects/api.ts` | `useReplaceWorkflow` |
| `frontend/src/features/projects/workflowEditorModel.ts` | **New** — draft, validate, serialize |
| `frontend/src/features/projects/workflowEditorModel.test.ts` | **New** |
| `frontend/src/features/projects/ProjectWorkflowEditor.tsx` | **New** — editable sections + dialogs |
| `frontend/src/features/projects/ProjectWorkflowSection.tsx` | Split read vs edit; loading/error; pass `canManage`, `archived`, org/key |
| `frontend/src/features/projects/ProjectPage.tsx` | Workflow tab: `canManage`, board+workflow load; Columns tab: **read-only for `project.manage`** |
| `frontend/src/features/projects/BoardColumnsEditor.tsx` | Support read-only mode / extract preview; **remove Save path** from Columns tab for managers |
| `frontend/src/features/projects/workflowDisplay.ts` | Optional small helpers for transition labels in forms |
| `frontend/src/features/projects/projects.test.tsx` | Extend workflow tab tests + `revision` |
| `frontend/src/features/projects/workflowEditor.test.tsx` | **New** |
| `frontend/e2e/a4a-fixtures.ts` | `revision`, mock PUT handler + telemetry |
| `frontend/e2e/project-settings.spec.ts` | Update workflow expectations for editor |
| `frontend/e2e/workflow-edit.spec.ts` | **New** |
| `docs/assessments/A4b.3-implementation-plan.md` | This document |

**Explicitly not changed in A4b.3**

- `AdminWorkflowHubPage.tsx` — no edit mode (maybe link only).
- Backend / migration `0020` / API shapes.
- Admin hub e2e except assertions staying read-only.
- **`PUT .../board/columns`** backend route (unused from project settings UI for editors after A4b.3).

---

## 9. Risks, dependencies, and implementation sequence

### 9.1 Dependencies

- A4b.2 backend deployed or available in dev with PUT + revision.
- Frontend `node_modules` + Node per `.nvmrc` for `gen:api`.
- CSRF + session flow unchanged.

### 9.2 Risks

| Risk | Mitigation |
|------|------------|
| Stale `schema.d.ts` blocks typed PUT | Step 0: `make openapi` |
| Column signature mismatch at load | Prefer board order + signature; client validation before save; refetch board+workflow on 412 reload |
| `status_in_use` extra save round trip | Remediation UI (§6.4); optional remap in delete dialog |
| Stale Columns tab after workflow save | §4.6 invalidation + refetch board query |
| Large PUT payload / UX complexity | Single-page sections; progressive disclosure (advanced transitions collapsed on mobile) |
| `useBlocker` new to codebase | Isolate in small hook `useUnsavedChangesWarning(dirty)` with unit test |
| Hub accidentally gains edit | Code review + `admin-workflow.spec.ts` guard |

### 9.3 Recommended implementation sequence

1. **Regenerate OpenAPI types** + fix type errors in fixtures/tests (`revision`).
2. **`workflowEditorModel`** + unit tests (pure logic).
3. **`useReplaceWorkflow`** + wire mutation invalidation.
4. **`ProjectWorkflowEditor`** sections (statuses → transitions → columns).
5. **`status_in_use` remediation UI** (§6.4) + delete confirm (optional proactive remap).
6. **Integrate `ProjectPage`** — Workflow editor; Columns tab read-only for managers.
7. **Conflict banner** + discard/save + cache invalidation (§4.6).
8. **Vitest** (permissions, 412, `status_in_use`, column id reorder).
9. **E2E** — workflow save; Columns tab no dual save; responsive spec.
10. **Manual QA** — save with WIP, 412, `status_in_use` remap resubmit, member read-only.

---

## 10. Acceptance criteria (for A4b.3 sign-off)

- [ ] Project admin / org owner can edit and save full graph via Workflow tab with one PUT and correct `If-Match`.
- [ ] Member/viewer sees read-only workflow; no PUT from UI.
- [ ] Admin Hub remains inspect-only.
- [ ] 412 preserves draft + reload path; no optimistic success UI.
- [ ] **`status_in_use`:** draft preserved; remap UI; second PUT includes `status_remaps` (§6.4).
- [ ] Column PUT payload preserves stable **`id`** by signature matching, not index; WIP sent via `ColumnInput.wip_limit`.
- [ ] **Single save path:** Workflow tab only for `project.manage`; Columns tab read-only (§4.5).
- [ ] After workflow save, workflow + board queries invalidated/refetched (§4.6).
- [ ] `make openapi-check`, frontend tests, and planned E2E pass.
- [ ] Responsive layout verified at mobile and desktop widths.

---

*Final plan details documented — awaiting review before any A4b.3 implementation.*
