# A4b.0 — Workflow Editing Security and Architecture Assessment

**Status:** Architecture assessment (post-review); **no implementation**
**Worktree:** `jira-project-a4b-workflow-editing`
**Branch:** `feat/org-workflow-admin-a4b`
**Base:** `origin/main` @ `1e33f57` (PR #69 merged)
**Last updated:** 2026-11-01 (preliminary approval review gate)

**Legend**

- **Verified** — observed in repository/migrations/tests on this base.
- **Proposed** — design for A4b implementation (not yet in code).

---

## 1. Verified current architecture

### 1.1 Data model (Verified)

| Table | Key constraints |
|-------|-----------------|
| `workflows` | `org_id`; deferrable FK `(org_id, id, initial_status_id)` → `workflow_statuses`; no `updated_at` / `revision` column today |
| `workflow_statuses` | UNIQUE `(workflow_id, name)`; CASCADE from workflow |
| `workflow_transitions` | UNIQUE `(workflow_id, from_status_id, to_status_id)` NULLS NOT DISTINCT |
| `projects` | UNIQUE `(workflow_id)` — 1:1 project ↔ workflow instance |
| `issues` | FK `(org_id, workflow_id, status_id)` → `workflow_statuses` **ON DELETE RESTRICT** (`0007_issues.py`, `models.py`) |
| `board_column_statuses` | FK `(org_id, workflow_id, status_id)` → `workflow_statuses` |
| `issue_activity` | Append-only for `app_rw`; stores transition history in `old_value`/`new_value` JSON (Verified: `0007`, `issues/service.py` `apply_transition`) |

**ADR** `docs/adr/0005-data-driven-workflows.md`: clone per project; editor deferred; cross-workflow migration is a future concern.

**Creation (Verified):** `repository.create_project()` inserts workflow graph + board 1:1 status→column in one transaction (`backend/app/modules/projects/repository.py`).

### 1.2 API surface (Verified)

| Method | Path | App permission | RLS (write) |
|--------|------|----------------|-------------|
| GET | `/projects/{key}/workflow` | `PROJECT_VIEW` (`ViewProject`) | SELECT member |
| PUT | `/projects/{key}/board/columns` | `BOARD_MANAGE` | `app_can_edit_board` |

No workflow mutation endpoints. OpenAPI: `get_workflow_api_v1_orgs__org_slug__projects__project_key__workflow_get` only.

### 1.3 Database privileges (Verified)

Migration `0006_projects.py` `_grants()`:

- `workflows`, `workflow_statuses`, `workflow_transitions`, …: **`GRANT SELECT, INSERT`** to `app_rw` only.
- **No** `UPDATE`/`DELETE` on workflow tables (unlike `0010_board_config_edit.py` for `board_columns`).

RLS: member `SELECT`; `INSERT` on workflow graph with `app_can_edit_workflow(workflow_id)`; **no UPDATE/DELETE policies** on workflow tables.

### 1.4 SECURITY DEFINER helpers (Verified)

From `0006_projects.py` (`MANAGERS = ARRAY['owner', 'admin']`):

```sql
-- app_can_manage_project(project)
--   org owner/admin OR (org member AND project_memberships.role = 'admin')

-- app_can_edit_workflow(workflow)
--   IF project exists for workflow THEN app_can_manage_project(that project)
--   ELSE app_can_create_projects(org)  -- in-flight project create only

-- app_can_edit_board(board)
--   app_can_manage_project(board.project_id)
```

**Verified:** Org **member** with project role **member** or **viewer** is **not** in `app_can_manage_project` and **cannot** pass `app_can_edit_workflow` for an attached workflow.

### 1.5 Application permissions (Verified)

`backend/app/authz/permissions.py`:

- `project_permissions(org_role, project_role)`:
  - **`owner` / `admin`** → `_PROJECT_ALL` (includes `PROJECT_MANAGE`, `BOARD_MANAGE`, `PROJECT_VIEW`, …) on **every** project in org (`resolve_project` + `_visible`).
  - **Project admin** → `_PROJECT_ALL`.
  - **Project member** → issues/comments; **`PROJECT_VIEW` only** (no `PROJECT_MANAGE` / `BOARD_MANAGE`).
  - **Project viewer** → `PROJECT_VIEW` only.
- **No** `workflow.manage` enum value exists.

`require_project` re-checks role inside `project_transaction` (`authz/projects.py`).

### 1.6 Frontend gates (Verified)

- **Admin Workflow Hub:** `AdminOrgManagePageFrame` `requireManage` → needs `org.manage` on org payload; A4a hub is **read-only** (`adminNav.ts` `requiresManage: true`).
- **Project Workflow tab:** `ProjectWorkflowSection` read-only; **Columns** tab uses `board.manage` via `ProjectPage` / `BoardColumnsEditor`.

### 1.7 Integrity tests (Verified)

- Cross-tenant / cross-workflow FK rejection: `test_cross_tenant_references_fail_on_composite_foreign_keys`, `test_board_column_cannot_map_a_status_from_another_workflow` (`test_projects.py`).
- Issue status must belong to project workflow: `test_composite_foreign_keys_reject_cross_tenant_and_cross_workflow_references` (`test_issues.py`).
- Initial status deferrable FK: `test_workflow_without_its_initial_status_cannot_commit`.

---

## 2. Authorization consistency

### 2.1 Exact authorization matrix (Verified behavior + Proposed API gate)

| Role | Read workflow (GET) | Edit workflow (Proposed PUT) | DB write (`app_can_edit_workflow`) |
|------|-------------------|------------------------------|-------------------------------------|
| **Organization owner** | All org projects (`PROJECT_VIEW` via `_PROJECT_ALL`) | **Yes**, all org projects | **Yes** (via `app_can_manage_project`) |
| **Organization admin** | Same | **Yes**, all org projects | **Yes** |
| **Project admin** | Assigned project(s) | **Yes**, assigned project only | **Yes**, that project’s workflow only |
| **Project member** | Assigned project(s) | **No** (`403` forbidden) | **No** |
| **Project viewer** | Assigned project(s) | **No** | **No** |
| **Org member, not on project** | **No** (`404` via `resolve_project`) | **No** | **No** |
| **Non-member** | **No** | **No** | **No** |

**Verified read path:** GET uses `ViewProject` → `PROJECT_VIEW`; org owner/admin receive `_PROJECT_ALL` including view on projects they are not members of (`permissions.py` lines 105–109, `projects.py` `_visible`).

**Verified DB edit predicate:** Matches **project manage** semantics, **not** org.manage alone without project visibility — but org owners/admins always satisfy `app_can_manage_project` for every project in their org.

**Proposed API alignment (no new permission):**

- Use existing **`Permission.PROJECT_MANAGE`** for workflow mutation routes (same dependency as `ManageProject` on PATCH/archive in `router.py`).
- **Justification:** `app_can_edit_workflow` is defined as `app_can_manage_project` for attached workflows (`0006` comment lines 11–16). Introducing `workflow.manage` would duplicate `_PROJECT_ALL` membership without changing the RLS predicate. **`BOARD_MANAGE` is insufficient** as the sole gate because workflow name/initial status/transitions are not board configuration (board already has its own permission).
- **Defense in depth:** Handler checks `PROJECT_MANAGE`; SQL mutations run under RLS with `app_can_edit_workflow`; cross-project isolation from **`projects.workflow_id`** + org context + 404 on wrong `{key}`.

**Verified separation of concerns:**

| Surface | Gate | Edit? |
|---------|------|-------|
| Admin Workflow Hub | `org.manage` (UI + frame) | A4a: read-only; A4b: **Proposed** optional “Edit in project settings” link only — **not** org-member workflow write |
| Project Workflow tab | `PROJECT_MANAGE` for PUT | **Proposed** editor |
| Project Columns tab | `BOARD_MANAGE` for PUT | Unchanged standalone PUT until editor ships bundled contract |

**Verified SQL bypass:** Ordinary members lack `UPDATE` grants on workflow tables; even direct SQL as `app_rw` cannot UPDATE/DELETE workflow rows today. After A4b.1, RLS UPDATE/DELETE policies still require `app_can_edit_workflow`.

---

## 3. Status deletion and issue remapping (Proposed design)

### 3.1 Verified constraints

| Constraint | Effect |
|------------|--------|
| `fk_issues_org_id_workflow_statuses` **RESTRICT** | Cannot `DELETE` status row while any issue references it |
| `issues.workflow_id` + composite status FK | Remap target must be same `workflow_id` |
| `issue_activity` | Insert-only; historical `transitioned` rows keep **immutable** `old_value`/`new_value` (status id + name at time of transition) |

**Verified:** Status changes on issues go through `repository.set_status` → `update_if_version` with optional `done_at` update (`issues/repository.py`); transitions append activity, **do not rewrite** prior activity.

### 3.2 Proposed deletion workflow (within workflow PUT transaction)

**Preconditions (application layer):**

1. Client sends **`ReplaceWorkflowRequest`** (see §5) including full desired graph + optional explicit **`status_remaps`**: `{ "from_status_id": "<uuid>", "to_status_id": "<uuid>" }` for each removed status that has ≥1 issue.
2. For every status **removed** from the payload (present in DB, absent in request):
   - Count issues in project with `status_id = removed_id`.
   - If count > 0: require remap entry; reject if missing (`422`, code e.g. `status_in_use`).
   - Reject if `from_status_id === to_status_id` (`422`).
   - Reject if `to_status_id` not in **new** status set or wrong workflow (`422`).
3. If removed status is **`initial_status_id`**: reject unless new graph sets a different valid initial **before** commit (or reject deletion of initial without replacement in graph).

**Transaction steps (single DB transaction; Proposed lock order §5):**

1. `SELECT … FROM workflows WHERE id = :wf FOR UPDATE` (revision check).
2. Validate graph (names, categories, positions, transitions, board mapping — §4).
3. **Remap issues (no activity rewrite):**
   ```sql
   UPDATE issues
      SET status_id = :to_id,
          version = version + 1,
          done_at = CASE WHEN :new_category = 'done' THEN COALESCE(done_at, now()) … END,
          updated_at = now()
    WHERE org_id = :org AND project_id = :project AND status_id = :from_id;
   ```
   - **Proposed:** Do **not** insert synthetic `issue_activity` for admin remap (avoids falsifying user history); optional **org audit** records bulk remap count only (§6).
   - **Verified precedent:** Issue PATCH creates per-field activity; bulk admin remap is configuration change, not user transition.
4. Update / insert / delete transition rows; update statuses; update `workflows.name`, `initial_status_id`, **`revision = revision + 1`**.
5. Apply board column mapping (§4) via same repository path as `replace_columns`.
6. Write audit event(s) (§6); commit.

**Initial status validity (Verified mechanism):** Deferrable FK on `workflows.initial_status_id` — commit must leave initial pointing at existing status row in same workflow (`test_workflow_without_its_initial_status_cannot_commit`).

**Concurrent issue create/transition (Proposed — required for safe delete):**

**Verified today:** `create_issue` and `apply_transition` use `project_transaction` only; they **do not** `SELECT … FROM workflows FOR UPDATE` (`issues/service.py`). Relying on workflow lock inside PUT **alone** does **not** yet serialize issue traffic.

**Proposed A4b.2 invariant:** Any transaction that assigns an issue a `status_id` (create, transition) **must** acquire the parent workflow row lock **before** reading `initial_status_id` or writing `issues.status_id`:

```sql
SELECT id FROM workflows WHERE id = :workflow_id FOR UPDATE;
```

Same lock order as PUT (§5.3 step 1). Workflow PUT therefore blocks concurrent creates/transitions for that project, and vice versa, for the duration of the transaction.

**Status deletion window (Proposed steps inside one PUT transaction):**

1. Lock `workflows` `FOR UPDATE`; validate `revision` / graph / remaps.
2. Lock issues on removing statuses: `SELECT id FROM issues WHERE project_id = :p AND status_id = ANY(:removing) FOR UPDATE`.
3. `UPDATE issues SET status_id = :to … WHERE status_id = :from` for each remap.
4. **Pre-delete guard:** `SELECT COUNT(*) FROM issues WHERE project_id = :p AND status_id = ANY(:removing)` must be **0** (else abort — should be impossible if step 2–3 + workflow lock on issue paths held).
5. Delete transitions referencing any `:removing` status (from or to); then delete status rows.
6. Board mapping + `revision = revision + 1` + audit; commit.

**Guarantee:** With workflow locking on **both** PUT and issue mutations, no new issue row and no transition can obtain `status_id = :removing` after step 3 completes in the same serial order. **Verified safety net:** `ON DELETE RESTRICT` on `issues.status_id` still prevents committing a status delete while any issue references it (failed PUT rolls back entire transaction).

| Concurrent action | Behavior (after A4b.2 locking) |
|-------------------|--------------------------------|
| **Create issue** | Waits on workflow lock; reads current `initial_status_id` after lock; cannot insert into a status being removed in an in-flight PUT. |
| **Apply transition** | Waits on workflow lock; cannot move an issue **onto** a status being deleted while PUT holds lock; cannot race remap on rows locked in step 2. |
| **Issue PATCH status** | Not exposed (Verified: status via transitions only). |

**Invalid replacement IDs:** Rejected at validation (`422`) before any issue UPDATE.

**A4b.1 note:** Migration `0020` does not implement issue-side locking; **A4b.4** must include integration tests proving the guarantee above once A4b.2 ships.

---

## 4. Board-column consistency (Proposed)

### 4.1 Verified today

- `boards/service.replace_columns`: validates `set(mapped status_ids) == all workflow status ids` (`workflow_status_ids()`).
- Rewrites `board_column_statuses` after column upsert (`boards/repository.replace_columns`).
- Standalone PUT remains **`BOARD_MANAGE`** + `board.columns.updated` audit.

### 4.2 Proposed atomic workflow + board contract

**Primary mutation:** `PUT /projects/{key}/workflow` body includes:

- `revision` (required, §5)
- `name`, `initial_status_id`, `statuses[]`, `transitions[]`
- **`columns[]`** — same shape as `ReplaceColumnsRequest.columns` (`ColumnInput`: id, name, wip_limit, status_ids)

**Rules (Proposed):**

| Operation | Workflow graph | Board columns (same transaction) |
|-----------|----------------|----------------------------------|
| **Add status** | New status row with position | Must assign new status id in exactly one column’s `status_ids` |
| **Remove status** | After issue remap + delete row | Remove status id from mappings; if column becomes empty, reject or require column delete (validate ≥1 column) |
| **Reorder statuses** | Update `position` only | Column order independent; status_ids unchanged unless remapping |
| **Remap status (issue remap)** | Delete old id, add/reuse target id | Update `status_ids` in columns to replace old uuid with new/target uuid |
| **Preserve 1:1 mapping** | Service validates `⋃ column.status_ids == set(status ids)` and pairwise disjoint | Same check as board PUT today |

**Implementation approach (Proposed):** Extract shared validation from `boards/service.replace_columns` into a function callable from **`projects/service.replace_workflow`**; call `boards/repository.replace_columns` inside the **same** `project_transaction` after workflow graph writes.

**Preserve existing board editor (Verified requirement):** Standalone `PUT .../board/columns` **unchanged** until A4b.3 ships unified editor; then both paths call shared core. Workflow-only PUT without column payload **rejected** if graph change would leave board invalid (forces bundled columns on any status add/remove).

---

## 5. Optimistic concurrency (Proposed)

### 5.1 Why not `updated_at` alone

**Verified:** `workflows` has **no** `updated_at` column. Issues use integer **`version`** + `If-Match: "v{n}"` (`412` / `428`) — proven pattern in `issues/router.py` and `issues/service.py`.

### 5.2 Proposed revision column

| Item | Spec |
|------|------|
| Column | `workflows.revision INTEGER NOT NULL DEFAULT 1` |
| On successful graph PUT | `revision = revision + 1` **once**, in the final `UPDATE workflows` of a committed transaction |
| Failed / stale / aborted | **No** increment (transaction rollback or early `412`/`422` before `UPDATE workflows`) |
| No-op PUT | **No** increment — handler compares normalized graph to DB; if identical, return `200` with current `revision` without mutating workflow row (A4b.2) |
| GET workflow response | Include **`revision`** in `WorkflowResponse` (breaking additive field) |
| Client PUT | **`If-Match: "w{revision}"`** or body field `expected_revision: int` (choose one; **Proposed:** mirror issues — header `If-Match: "w3"` + `428` if missing) |
| Stale | **`412 Precondition Failed`**, code `workflow_revision_conflict`, message for UI reload |

### 5.3 Locking order (Proposed — deadlock avoidance)

Within one workflow PUT transaction, acquire locks in this **fixed order**:

1. **`workflows`** row `FOR UPDATE` (by `workflow_id`)
2. **`projects`** row `FOR UPDATE` (by `project_id`) — optional but stabilizes archive checks
3. **`issues`** rows to remap: `SELECT id FROM issues WHERE project_id = :p AND status_id = ANY(:removing) FOR UPDATE`
4. **`boards`** / **`board_columns`** — via existing replace logic (column ids sorted consistently)
5. Graph deletes last: transitions → statuses (after remaps)

**Do not** lock issue rows project-wide. Concurrent issue updates on other statuses proceed; remapped rows serialized by step 3.

### 5.4 Tests (Proposed)

- Two parallel PUTs with same revision → one `412`.
- PUT during issue transition → transition succeeds or `412` independently; workflow PUT waits on issue row locks for remapped statuses only.
- Integration test with two HTTP clients (pattern from issue version tests).

---

## 6. Transactional audit (Proposed)

### 6.1 Verified pattern

`audit.record()` in caller transaction; allowlist in `ACTION_METADATA_ALLOWLIST`; failure rolls back mutation (`audit/service.py`). Example: `board.columns.updated` with `{ project, columns }` count.

### 6.2 Proposed event model — **granular actions**

Use **separate actions** (easier allowlisting and org audit filtering than one blob):

| Action | When | Allowlisted metadata |
|--------|------|----------------------|
| `workflow.metadata.updated` | `name` and/or graph revision bump without status id churn | `{ project, fields }` (`fields` ⊆ `name`) |
| `workflow.initial_status.changed` | `initial_status_id` changes | `{ project, from_status_id, to_status_id }` |
| `workflow.status.created` | New status id in PUT | `{ project, status_id, name }` |
| `workflow.status.updated` | Same id, name/category/position change | `{ project, status_id, fields }` |
| `workflow.status.deleted` | Status removed | `{ project, status_id, replacement_status_id, issues_remapped }` (count int, no issue keys) |
| `workflow.transition.created` | New transition id | `{ project, transition_id, name }` |
| `workflow.transition.deleted` | Transition removed | `{ project, transition_id }` |
| `workflow.board_mapping.updated` | Column/status mapping changed inside workflow PUT | `{ project, columns }` (count only, same as board) |

**Rules:**

- Emit **only** events for actual diffs after successful validation.
- **`412` / validation failure:** no audit rows.
- **Same transaction** as workflow/board DB writes.
- **Never** store issue titles, comments, or PII in metadata.
- **Target:** `target_type=project`, `target_id=<project uuid>`.

**Alternative (Unresolved):** Single `workflow.updated` with compact diff — rejected for v1 unless review prefers fewer action types (see §8).

---

## 7. Final A4b delivery plan (revised)

### A4b.1 — Database permissions, revision, integrity foundations

| | |
|--|--|
| **Dependencies** | None |
| **Migration (Proposed)** | `backend/migrations/versions/0020_workflow_edit.py`: add `workflows.revision`; `GRANT UPDATE (name, initial_status_id, revision)` on `workflows`; `UPDATE (name, category, position), DELETE` on `workflow_statuses`; `UPDATE (name, from_status_id, to_status_id), DELETE` on `workflow_transitions`; RLS policies USING/WITH CHECK `app_can_edit_workflow(workflow_id)` + `org_id = app_current_org()` |
| **Files (anticipated)** | `0020_workflow_edit.py`; `models.py` (`revision`); `test_architecture.py` table list if needed |
| **API** | None (revision returned later) |
| **Tests** | Integration: project admin UPDATE status name via SQL as `app_rw` succeeds; member denied; cross-org denied; revision default 1 |
| **Acceptance** | Migration up/down documented; no app behavior change yet |
| **Rollback risk** | Downgrade revokes grants — ensure no deployment runs new code before migration |

### A4b.2 — Backend mutation API, validation, remap, audit

| | |
|--|--|
| **Dependencies** | A4b.1 |
| **API (Proposed)** | `PUT /projects/{key}/workflow` + `If-Match: "w{revision}"`; `ReplaceWorkflowRequest`; `WorkflowResponse.revision`; OpenAPI + `schema.d.ts` |
| **Files (anticipated)** | `projects/router.py`, `service.py`, `repository.py`, `schemas.py`; `boards/service.py` (shared validation); `audit/service.py` allowlist; `openapi.json`; `tests/integration/test_workflow_edit.py` (new); extend `test_projects.py` |
| **Authorization** | `ManageProject` (`PROJECT_MANAGE`) + RLS |
| **Tests** | Remap with issues; delete status without remap fails; self-replacement fails; initial status invalid; audit rows; `412` revision; archived project rejected |
| **Acceptance** | All integration tests pass; `make openapi-check` |

### A4b.3 — Frontend workflow editor

| | |
|--|--|
| **Dependencies** | A4b.2 stable contract |
| **Files (anticipated)** | `ProjectWorkflowSection.tsx` (edit mode); new editor subcomponents; `features/projects/api.ts`; `ProjectPage.tsx`; optional hub link in `AdminWorkflowHubPage.tsx`; Vitest; extend `a4a-fixtures.ts` / new Playwright specs |
| **UX** | Edit on **project** Workflow tab only for `project.manage`; hub stays read-only inspect; `412` → reload banner |
| **Acceptance** | Authorized admin saves graph; member viewer read-only; no workflow mutation controls for viewers |

### A4b.4 — Issue/board consistency & concurrency regression

| | |
|--|--|
| **Dependencies** | A4b.2–A4b.3 |
| **Files (anticipated)** | `tests/integration/test_workflow_edit_concurrency.py`; extend `test_board.py`, `test_issues_hierarchy.py`; frontend tests for column+workflow bundle |
| **Acceptance** | Parallel PUT test; board standalone PUT still works; transitions after graph edit; unmapped status blocked |

### A4b.5 — CI, browser QA, migration downgrade, release verification

| | |
|--|--|
| **Dependencies** | A4b.1–A4b.4 |
| **Files (anticipated)** | `e2e/workflow-edit.spec.ts`; `make ci` path; migration downgrade smoke in CI or `migrate-roundtrip` docs |
| **Acceptance** | Playwright green; full CI on PR; assessment checklist signed |

---

## 8. Unresolved technical decisions and risks

These are **product/design choices**, not blockers for A4b.1 schema work. Each row states the decision, options, and the **current recommendation** (subject to your override before A4b.2).

| # | Decision / risk | Options | Recommendation |
|---|-----------------|---------|----------------|
| **U1** | **Granular vs single audit action** | (a) Separate actions per §6.2 (`workflow.status.deleted`, …). (b) One `workflow.updated` with structured diff blob. | **(a) Granular** — matches existing allowlist pattern (`board.columns.updated`, field-scoped org settings). Easier to filter in Admin Audit without parsing nested diffs. |
| **U2** | **Issue remap → `issue_activity`** | (a) No per-issue activity; org audit only (`issues_remapped` count). (b) Bulk synthetic `transitioned` / `field=status` rows for every remapped issue. | **(a) Silent remap** — preserves append-only history as factual user actions; admin remap is configuration, not impersonated user transitions. |
| **U3** | **Admin hub inline edit vs project-only** | (a) Full editor on hub for anyone with `org.manage`. (b) Hub stays inspect-only; edit only on project Workflow tab (`PROJECT_MANAGE`). | **(b) Project tab primary** — aligns API/RLS with `app_can_edit_workflow` / project manage; hub deep-links to project settings (A4a inspect pattern). |
| **U4** | **`If-Match` format** | (a) `"w{n}"` integer tag like issues’ `"v{n}"`. (b) Opaque ETag hash of graph bytes. | **(a) `"w{n}"`** — same client/server semantics as issues; no cache hashing of large payloads. |
| **U5** | **Status delete with zero issues** | (a) Allow removing status id from graph if columns updated in same PUT and count=0. (b) Require explicit “archive status” flag even when empty. | **(a) Allow drop** when board mapping in payload remains valid and no issues reference the status. |
| **U6** | **Transition graph simplification** | (a) Only explicit `workflow_transitions` rows (current seed model). (b) Auto-generate all-to-all or category-based rules. | **(a) Explicit rows** — matches ADR 0005 and existing `apply_transition` lookup by id. |
| **R1** | **Long-running PUT vs issue traffic** | Workflow row held `FOR UPDATE` for whole PUT; issue create/transition also take workflow lock (§3.2). | **Risk:** queueing under heavy edit load. **Mitigation:** keep graph diff minimal; monitor lock wait / `lock_not_available` in A4b.4. |
| **R2** | **CITEXT status rename collisions** | Unique `(workflow_id, name)` on `workflow_statuses`. | **Mitigation:** pre-check in service → `422 status_name_taken` before hitting DB unique violation. |
| **R3** | **Downgrade after partial deploy** | App code expecting `workflows.revision` while DB downgraded. | **Mitigation:** migrate-before-deploy; A4b.5 downgrade roundtrip in CI; never run new backend against old schema. |

### 8.1 Pre-A4b.1 verification (review gate)

| Review question | Verdict | Evidence / contract |
|-----------------|---------|---------------------|
| **1. Status deletion concurrency** — no new issue/transition may reference a status after remap and before delete | **Proposed contract complete; A4b.2 + A4b.4 required to implement & test** | DB: `ON DELETE RESTRICT` on `issues.status_id` (Verified `0007`). App: workflow `FOR UPDATE` on PUT **and** on issue create/transition (§3.2); pre-delete `COUNT(*)=0` guard; transition rows removed before status `DELETE`. Not in code today. |
| **2. Permission enforcement alignment** | **Verified predicate; Proposed API matches** | `app_can_edit_workflow(w)` ↔ `app_can_manage_project(project for w)` (`0006`). RLS policies in `0020` will use same helper. API: `ManageProject` / `PROJECT_MANAGE` on `{project_key}` route — project admin only receives manage on **assigned** projects (`permissions.py`); cannot call PUT for another project’s key (`404`/`403`). Org owner/admin: manage all projects in org. Hub edit **not** gated on `org.manage` alone for writes. Cross-workflow: 1:1 `projects.workflow_id` — no path to pass another workflow id without project scope. **A4b.1 tests:** SQL as `app_rw` UPDATE denied for member on foreign project workflow. |
| **3. Revision consistency** | **Proposed rules for A4b.2; column only in A4b.1** | Single `UPDATE workflows SET revision = revision + 1` at end of successful TX. Stale `If-Match` → `412` before writes. Validation failure → rollback, no bump. **No-op** → no bump (explicit diff). Failed mid-TX → rollback restores old revision. A4b.1: column defaults to `1`, no app increment yet. |

**Your override:** Reply with any U1–U6 choice you want changed before A4b.2; A4b.1 can proceed on schema + RLS regardless.

---

## 9. A4b.1 acceptance checklist (explicit)

Before starting A4b.2 application code:

- [ ] Migration `0020` adds `workflows.revision NOT NULL DEFAULT 1`.
- [ ] `GRANT`/`REVOKE` documented in migration header (comment block like `0010`).
- [ ] RLS UPDATE/DELETE policies on `workflows`, `workflow_statuses`, `workflow_transitions` use **`app_can_edit_workflow(workflow_id)`** (Verified helper unchanged).
- [ ] **`app_can_edit_workflow` SQL not altered** unless product reverses org-admin/project-admin matrix.
- [ ] Integration proof: org **owner** can UPDATE status; project **admin** on assigned project can; project **member** cannot; other project’s workflow cannot.
- [ ] `alembic upgrade` / downgrade tested locally on empty + seeded DB.
- [ ] No OpenAPI/router/UI changes in A4b.1 (schema-only + tests).
- [ ] Primary worktree and other worktrees untouched.

---

## 10. Scope and exclusions (unchanged)

**In scope for A4b (overall):** Per-project workflow graph mutation; safe status remap; revision concurrency; audit; project Workflow editor.

**Out of scope:** Org-wide workflow templates; per-issue-type workflows; changing `projects.workflow_id`; workflow version history UI; custom fields; bypassing RLS; granting edit to ordinary project members.

**This document / A4b.0:** No product code, migrations, grants, RLS, `.env`, commits, or pushes.

---

## Appendix A — Key file inventory (Verified)

| Area | Paths |
|------|--------|
| Migrations | `backend/migrations/versions/0006_projects.py`, `0007_issues.py`, `0010_board_config_edit.py` |
| Models | `backend/app/modules/projects/models.py` |
| Projects API | `router.py`, `service.py`, `repository.py`, `schemas.py`, `defaults.py` |
| Boards API | `backend/app/modules/boards/service.py`, `repository.py`, `schemas.py` |
| Issues / transitions | `backend/app/modules/issues/service.py`, `repository.py`, `router.py` |
| Authz | `backend/app/authz/permissions.py`, `projects.py` |
| Audit | `backend/app/modules/audit/service.py` |
| Admin UI | `frontend/src/features/admin/pages/AdminWorkflowHubPage.tsx`, `adminNav.ts` |
| Project UI | `ProjectWorkflowSection.tsx`, `BoardColumnsEditor.tsx`, `ProjectPage.tsx` |
| ADR | `docs/adr/0005-data-driven-workflows.md` |
| A4a tests | `adminWorkflow.test.tsx`, `e2e/a4a-fixtures.ts`, `e2e/admin-workflow.spec.ts` |

---

*Stop here. Await explicit approval before implementing A4b.1.*
