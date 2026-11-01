# A4b.2 — Workflow editing backend (implementation plan)

**Status:** Approved to implement
**Depends on:** A4b.1 (`0020`, RLS/grants, `workflows.revision`)
**Assessment:** `A4b.0-workflow-editing-security-architecture.md`

---

## 1. API contracts

### GET `/api/v1/orgs/{org_slug}/projects/{project_key}/workflow`

- **Permission:** `PROJECT_VIEW` (unchanged).
- **Response:** `WorkflowResponse` — add **`revision: int`** (additive).

### PUT `/api/v1/orgs/{org_slug}/projects/{project_key}/workflow`

- **Permission:** `PROJECT_MANAGE` (`ManageProject`).
- **Headers:** `If-Match: "w{revision}"` **required** (mirror issues).
- **Body:** `ReplaceWorkflowRequest` (`extra=forbid`):
  - `name: str`
  - `initial_status_id: UUID`
  - `statuses: list[StatusInput]` — each: `id: UUID | null` (null = create), `name`, `category`, `position`
  - `transitions: list[TransitionInput]` — each: `id: UUID | null`, `name`, `from_status_id | null`, `to_status_id`
  - `columns: list[ColumnInput]` — reuse `boards.schemas.ColumnInput` (bundled board mapping)
  - `status_remaps: list[StatusRemapInput]` — `from_status_id`, `to_status_id` (required when deleting a status with issues)
- **Response:** `WorkflowResponse` (post-mutation graph + new `revision`).
- **CSRF:** `CsrfProtected` (same as PATCH project / board columns).

### Error behavior

| Code | `code` | When |
|------|--------|------|
| 428 | `precondition_required` | Missing `If-Match` |
| 412 | `workflow_revision_conflict` | Bad ETag format or stale revision |
| 409 | `project_archived` | Archived project |
| 422 | `status_in_use` | Status removed with issues but no remap |
| 422 | `status_name_taken` | Duplicate status name (incl. CITEXT collision) |
| 422 | `invalid_workflow` | Graph validation (initial status, transitions, columns) |
| 422 | `invalid_board_columns` | Column mapping ≠ status set (reuse board message shape) |
| 403 | `forbidden` | No `PROJECT_MANAGE` |
| 404 | — | Unknown project / no access |

**No-op:** Normalized body equals DB → **200**, same `revision`, no audit, no `revision` bump.

---

## 2. Service-layer responsibilities

| Module | Responsibility |
|--------|----------------|
| `projects/router.py` | Parse `If-Match` (`WORKFLOW_ETAG = re w(\d+)`), wire PUT/GET |
| `projects/service.py` | `replace_workflow()` orchestration; archived check; call validator + repository + audit |
| `projects/workflow_edit.py` (new) | Pure validation: graph invariants, remap rules, no-op canonical compare, diff for audit |
| `projects/repository.py` | `lock_workflow`, `lock_project`, issue locks/remap, persist graph + `revision += 1`, extend `workflow_view` |
| `boards/column_mapping.py` (new) | Shared validate + `replace_columns` inputs (used by board PUT and workflow PUT) |
| `boards/service.py` | Call shared validator from `replace_columns` (behavior unchanged) |
| `issues/repository.py` | `lock_workflow_row(session, workflow_id)` |
| `issues/service.py` | Call workflow lock before `initial_status` / `set_status` in create + apply_transition |
| `audit/service.py` | Allowlist workflow.* actions |

---

## 3. Authorization and RLS

- **API:** `require_project(Permission.PROJECT_MANAGE)` on PUT only.
- **DB:** Existing `app_can_edit_workflow` on UPDATE/DELETE/INSERT (A4b.1); no grant changes.
- **Hub:** No new routes; admin hub stays read-only (A4b.3).

---

## 4. Revision and If-Match

- Load workflow with `FOR UPDATE`; compare `revision` to parsed `If-Match`.
- Mutations: single `UPDATE workflows SET …, revision = revision + 1` at end of successful TX.
- No-op: return before any graph write or revision update.
- Failed/stale: raise before writes; TX rollback → no audit, no revision change.

---

## 5. Transaction and lock order

Within `project_transaction` (one DB transaction):

1. `workflows` `FOR UPDATE` (by `project.workflow_id`)
2. `projects` `FOR UPDATE` (by `project.id`)
3. Validate + compute diff (no writes yet except locks)
4. If remaps: `issues` `SELECT … FOR UPDATE` where `project_id` and `status_id = ANY(removing)`
5. Issue `UPDATE` remaps (no `issue_activity`)
6. Pre-delete guard: zero issues on removing statuses
7. Graph writes: transitions delete → status delete → status insert/update → transition insert/update; update `name`, `initial_status_id`
8. `boards/repository.replace_columns` (column ids sorted consistently)
9. `workflows.revision += 1` + audit records
10. Commit

**Issue create / transition (same order start):**

1. `lock_workflow_row` then existing issue logic.

---

## 6. Status deletion and remapping

- Removed status ids = in DB not in request payload (by id).
- For each removed id: if `issue_count > 0`, require matching `status_remaps` entry; `to` must be in post-graph status set; `from != to`.
- Cannot delete `initial_status_id` without new valid initial in payload.
- Remap: bump `issues.version`, adjust `done_at` from target category; **no** `issue_activity`.
- Delete transitions touching removed statuses, then delete statuses.

---

## 7. Board-column consistency

- PUT **requires** `columns[]` whenever the graph or mapping must stay consistent (always in v1: **always required** on PUT to simplify).
- Validator: every status id exactly once across columns; column ids belong to board; same rules as `boards/service.replace_columns`.
- Emit `workflow.board_mapping.updated` only when mapping changes.

---

## 8. Audit (granular, same TX)

Allowlist additions:

- `workflow.metadata.updated` — `{ project, fields }`
- `workflow.initial_status.changed` — `{ project, from_status_id, to_status_id }`
- `workflow.status.created` — `{ project, status_id, name }`
- `workflow.status.updated` — `{ project, status_id, fields }`
- `workflow.status.deleted` — `{ project, status_id, replacement_status_id, issues_remapped }`
- `workflow.transition.created` — `{ project, transition_id, name }`
- `workflow.transition.deleted` — `{ project, transition_id }`
- `workflow.board_mapping.updated` — `{ project, columns }` (count)

Target: `target_type=project`, `target_id=<uuid>`.

---

## 9. Tests (new / updated)

| File | Coverage |
|------|----------|
| `tests/integration/test_workflow_edit.py` | PUT happy path; 428/412; no-op; duplicate name; delete+remap; delete without remap; auth matrix (owner, project admin, member); audit rows; board mapping |
| `tests/integration/test_workflow_edit_concurrency.py` | Workflow PUT vs issue create (same project) — serialized via locks |
| `test_workflow_edit_foundation.py` | Update `revision` exposed in GET |
| `test_projects.py` | Extend workflow GET for `revision` if needed |

---

## 10. Files anticipated (no frontend)

- `backend/app/modules/projects/workflow_edit.py` (new)
- `backend/app/modules/projects/service.py`, `repository.py`, `router.py`, `schemas.py`
- `backend/app/modules/boards/column_mapping.py` (new), `service.py`
- `backend/app/modules/issues/repository.py`, `service.py`
- `backend/app/modules/audit/service.py`
- `backend/openapi.json` (+ `frontend/src/schema.d.ts` if repo policy requires sync on OpenAPI change)
- `backend/tests/integration/test_workflow_edit.py`, `test_workflow_edit_concurrency.py`

**No** migration `0021` unless schema blocker discovered.

---

*Plan documented — implementation proceeds per this document.*
