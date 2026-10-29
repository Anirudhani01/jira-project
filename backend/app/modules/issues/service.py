"""Issue use cases (plan M6/M7, R4, R7-M6, R7-M7).

- Every operation runs in ONE transaction that re-checks the caller's project access
  (``project_transaction``); issues of projects the caller cannot view are 404, exactly
  like unknown issues (organization membership alone grants nothing).
- Create: optional ``Idempotency-Key`` claimed first; issue number allocated from
  ``project_issue_counters`` as the last step before the insert, so a failed create never
  consumes a number; the ``created`` activity row is written in the same transaction.
- Update: requires the version the client last saw (``If-Match``); conditional update
  bumps ``version``; one activity row per changed field, same transaction.
- Hierarchy (M7, plan R3.3 row 12): an epic has no parent; a standard issue's parent, if
  any, is an epic; a sub-task requires a parent that is a standard issue. The three levels
  make cycles structurally impossible (nothing can point to a sub-task as a parent), so no
  separate cycle check is needed. Deleting a standard issue soft-deletes its sub-tasks with
  it; deleting an epic detaches its children instead of deleting them.
- Assignment (M7, plan R3.3 row 14): the assignee must be an active org owner/admin
  (implicit project admin everywhere) or hold the project's admin/member role; removed
  members are unassigned (M4/M6's ``unassign_member``).
- Transitions (M7, plan R3.3 row 10, invariant 6): status changes only through a
  permitted ``workflow_transitions`` row matching the issue's current status (or one with
  no ``from_status_id``, meaning any status); gated the same way as other mutations
  (``If-Match``/``version``).
"""

import base64
import binascii
import hashlib
import json
import uuid
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from sqlalchemy import func
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import OrgAccess, forbidden, not_found, org_transaction
from app.authz.issues import IssueRef
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.identity.directory import visible_users
from app.modules.issues import rank as ranking
from app.modules.issues import repository
from app.modules.issues.models import Issue, Label
from app.modules.issues.repository import IssueFilter, NewIssue
from app.modules.issues.schemas import (
    ActivityResponse,
    ApplyTransitionRequest,
    CreateIssueRequest,
    IssueRefShort,
    IssueResponse,
    LabelRef,
    LabelResponse,
    MoveIssueRequest,
    PriorityRef,
    SprintRef,
    StatusRef,
    TransitionRef,
    TypeRef,
    UpdateIssueRequest,
    UserRef,
)
from app.modules.notifications import service as notifications
from app.modules.orgs import repository as orgs
from app.modules.projects import repository as projects
from app.modules.projects.models import Project
from app.modules.projects.service import project_archived
from app.modules.security_events.service import ClientInfo
from app.modules.sprints import repository as sprints

FORMER_MEMBER = "Former member"
LOCK_NOT_AVAILABLE = "55P03"


def version_conflict() -> AppError:
    return AppError(
        412, "version_conflict", "The issue was changed by someone else. Reload and retry."
    )


def invalid_field(field: str, code: str, message: str) -> AppError:
    return AppError(422, code, message, errors=[{"field": f"body.{field}", "message": message}])


def invalid_cursor() -> AppError:
    return AppError(400, "invalid_cursor", "The cursor is invalid for this request.")


# ------------------------------------------------------------------------ responses
def _user(users: dict[uuid.UUID, Any], user_id: uuid.UUID | None) -> UserRef | None:
    if user_id is None:
        return None
    user = users.get(user_id)
    return UserRef(id=user_id, display_name=user.display_name if user else FORMER_MEMBER)


def _reporter(users: dict[uuid.UUID, Any], user_id: uuid.UUID) -> UserRef:
    user = users.get(user_id)
    return UserRef(id=user_id, display_name=user.display_name if user else FORMER_MEMBER)


def _response(
    row: Any,
    users: dict[uuid.UUID, Any],
    labels_by_issue: dict[uuid.UUID, list[Label]],
    parents: dict[uuid.UUID, Any],
) -> IssueResponse:
    issue = row.Issue
    parent_ref = None
    if issue.parent_id is not None and (parent := parents.get(issue.parent_id)) is not None:
        parent_ref = IssueRefShort(
            id=issue.parent_id, key=f"{parent.project_key}-{parent.seq}", summary=parent.summary
        )
    return IssueResponse(
        id=issue.id,
        key=f"{row.project_key}-{issue.seq}",
        project_key=row.project_key,
        summary=issue.summary,
        description=issue.description,
        type=TypeRef(id=issue.type_id, name=row.type_name, kind=row.type_kind),
        status=StatusRef(id=issue.status_id, name=row.status_name, category=row.status_category),
        priority=PriorityRef(
            id=issue.priority_id, name=row.priority_name, color=row.priority_color
        ),
        reporter=_reporter(users, issue.reporter_id),
        assignee=_user(users, issue.assignee_id),
        parent=parent_ref,
        sprint=SprintRef(id=issue.sprint_id, name=row.sprint_name, state=row.sprint_state)
        if issue.sprint_id is not None and row.sprint_name is not None
        else None,
        labels=[
            LabelRef(id=label.id, name=label.name, color=label.color)
            for label in labels_by_issue.get(issue.id, [])
        ],
        version=issue.version,
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


async def issue_responses(session: AsyncSession, rows: list[Any]) -> list[IssueResponse]:
    ids = {r.Issue.reporter_id for r in rows} | {
        r.Issue.assignee_id for r in rows if r.Issue.assignee_id
    }
    users = await visible_users(session, sorted(ids))
    labels_by_issue = await repository.list_issue_labels_bulk(session, [r.Issue.id for r in rows])
    parent_ids = sorted({r.Issue.parent_id for r in rows if r.Issue.parent_id})
    parents = await repository.find_issue_refs(session, parent_ids)
    return [_response(r, users, labels_by_issue, parents) for r in rows]


async def _issue_response(session: AsyncSession, issue_id: uuid.UUID) -> IssueResponse:
    [response] = await issue_responses(session, [await repository.issue_view(session, issue_id)])
    return response


# ---------------------------------------------------------------------- validation
async def _type_kind(session: AsyncSession, type_id: uuid.UUID) -> tuple[dict[str, str], str]:
    issue_type = await repository.find_type(session, type_id)
    if issue_type is None:
        raise invalid_field("type_id", "invalid_type", "Unknown issue type.")
    return {"id": str(issue_type.id), "name": issue_type.name}, issue_type.kind


async def _priority_ref(session: AsyncSession, priority_id: uuid.UUID) -> dict[str, str]:
    priority = await repository.find_priority(session, priority_id)
    if priority is None:
        raise invalid_field("priority_id", "invalid_priority", "Unknown priority.")
    return {"id": str(priority.id), "name": priority.name}


def _writable(project: Project) -> None:
    if project.archived_at is not None:
        raise project_archived()


async def _validate_hierarchy(
    session: AsyncSession,
    project_id: uuid.UUID,
    kind: str,
    parent_id: uuid.UUID | None,
    *,
    self_id: uuid.UUID | None = None,
) -> Issue | None:
    """Enforces the epic -> standard -> sub-task levels (plan R3.3 row 12). Returns the
    parent row, or ``None`` when the issue has no parent. ``self_id`` (update only) rejects
    an issue naming itself as its own parent with a clean 422: left unchecked, the request
    can otherwise reach the database's ``ck_issues_parent_not_self`` CHECK constraint as an
    unhandled error instead (e.g. a standard issue PATCHed to ``subtask`` with its own id
    as ``parent_id`` -- its own, still-``standard`` kind satisfies the subtask/parent-kind
    check above before the self-reference is ever considered)."""
    if kind == "epic":
        if parent_id is not None:
            raise invalid_field(
                "parent_id", "epic_cannot_have_parent", "Epics cannot have a parent."
            )
        return None
    if kind == "subtask" and parent_id is None:
        raise invalid_field("parent_id", "subtask_requires_parent", "Sub-tasks must have a parent.")
    if parent_id is None:
        return None
    if self_id is not None and parent_id == self_id:
        raise invalid_field(
            "parent_id", "parent_cannot_be_self", "An issue cannot be its own parent."
        )
    found = await repository.find_candidate_parent(session, project_id, parent_id)
    if found is None:
        raise invalid_field("parent_id", "invalid_parent", "Unknown issue.")
    parent, parent_kind = found
    required = "standard" if kind == "subtask" else "epic"
    if parent_kind != required:
        raise invalid_field(
            "parent_id", "invalid_parent_kind", f"The parent must be a {required} issue."
        )
    return parent


async def _validate_assignee(
    session: AsyncSession, project: Project, assignee_id: uuid.UUID
) -> None:
    """The assignee must be an active org owner/admin (implicit project admin, §1.1) or
    hold the project's admin/member role (plan R3.3 row 14)."""
    membership = await orgs.get_member(session, assignee_id)
    if (
        membership is not None
        and membership.removed_at is None
        and membership.role
        in (
            "owner",
            "admin",
        )
    ):
        return
    role = await projects.get_project_member(session, project.id, assignee_id)
    if role in ("admin", "member"):
        return
    raise invalid_field(
        "assignee_id", "invalid_assignee", "The assignee must be an active project member."
    )


async def _validate_labels(
    session: AsyncSession, project_id: uuid.UUID, label_ids: list[uuid.UUID]
) -> dict[uuid.UUID, Label]:
    all_labels = {label.id: label for label in await repository.list_labels(session, project_id)}
    if any(label_id not in all_labels for label_id in label_ids):
        raise invalid_field("label_ids", "invalid_label", "Unknown label.")
    return all_labels


# --------------------------------------------------------------------------- create
@dataclass(frozen=True, slots=True)
class Created:
    issue: IssueResponse
    replayed: bool


def request_hash(project_key: str, body: CreateIssueRequest) -> bytes:
    """Binds an idempotency key to the exact request (route, project and body)."""
    canonical = json.dumps(
        {"route": "issues.create", "project": project_key, "body": body.model_dump(mode="json")},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).digest()


async def create_issue(
    services: IdentityServices,
    access: ProjectAccess,
    body: CreateIssueRequest,
    idempotency_key: str | None,
) -> Created:
    try:
        async with project_transaction(services, access, Permission.ISSUE_CREATE) as (
            session,
            project,
            current,
        ):
            _writable(project)
            if idempotency_key is not None:
                fingerprint = request_hash(project.key, body)
                if not await repository.claim_idempotency_key(
                    session, idempotency_key, fingerprint
                ):
                    # Access was re-checked above in this transaction, so a replay never
                    # discloses an issue to a caller who lost access since (decision 5).
                    stored = await repository.find_idempotency_key(session, idempotency_key)
                    if stored is None or stored.response_body is None:
                        raise _in_progress()
                    if stored.request_hash != fingerprint:
                        raise AppError(
                            422,
                            "idempotency_key_reused",
                            "This Idempotency-Key was already used for a different request.",
                        )
                    return Created(IssueResponse.model_validate(stored.response_body), True)
            type_ref, kind = await _type_kind(session, body.type_id)
            await _priority_ref(session, body.priority_id)
            await _validate_hierarchy(session, project.id, kind, body.parent_id)
            if body.assignee_id is not None:
                if Permission.ISSUE_ASSIGN not in current.permissions:
                    raise forbidden()
                await _validate_assignee(session, project, body.assignee_id)
            if body.label_ids:
                await _validate_labels(session, project.id, body.label_ids)
            status_id = await repository.initial_status(session, project.workflow_id)
            issue_id = uuid.uuid4()
            seq = await repository.allocate_seq(session, project.id)
            await repository.insert_issue(
                session,
                NewIssue(
                    id=issue_id,
                    project=project,
                    seq=seq,
                    type_id=body.type_id,
                    status_id=status_id,
                    priority_id=body.priority_id,
                    reporter_id=current.org.user_id,
                    summary=body.summary,
                    description=body.description,
                    parent_id=body.parent_id,
                    assignee_id=body.assignee_id,
                ),
            )
            if body.label_ids:
                await repository.set_issue_labels(
                    session, project.id, issue_id, add=set(body.label_ids), remove=set()
                )
            await repository.add_activity(
                session,
                [{"issue_id": issue_id, "action": "created", "new_value": {"type": type_ref}}],
            )
            await notifications.notify(
                session,
                project_id=project.id,
                issue_id=issue_id,
                kind="issue_assigned",
                candidates=[body.assignee_id],
                payload={"summary": body.summary},
            )
            response = await _issue_response(session, issue_id)
            if idempotency_key is not None:
                await repository.store_idempotent_response(
                    session, idempotency_key, 201, response.model_dump(mode="json")
                )
            return Created(response, False)
    except DBAPIError as error:
        if getattr(error.orig, "sqlstate", None) == LOCK_NOT_AVAILABLE:
            raise _in_progress() from error
        raise


def _in_progress() -> AppError:
    return AppError(
        409, "idempotency_in_progress", "The original request is still in progress. Retry."
    )


# ----------------------------------------------------------------------- read / list
async def _load(session: AsyncSession, project: Project, ref: IssueRef) -> Any:
    issue = await repository.find_issue(session, project.id, ref.seq)
    if issue is None:
        raise not_found()
    return issue


async def get_issue(services: IdentityServices, ref: IssueRef) -> IssueResponse:
    async with project_transaction(services, ref.project, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        issue = await _load(session, project, ref)
        return await _issue_response(session, issue.id)


def encode_cursor(sort: str, value: datetime, last_id: uuid.UUID) -> str:
    raw = json.dumps([sort, value.isoformat(), str(last_id)]).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def decode_cursor(cursor: str, sort: str) -> tuple[datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        cursor_sort, value, last_id = json.loads(raw)
        if cursor_sort != sort:
            raise invalid_cursor()
        return datetime.fromisoformat(value), uuid.UUID(last_id)
    except (ValueError, TypeError, binascii.Error) as error:
        raise invalid_cursor() from error


@dataclass(frozen=True, slots=True)
class ListQuery:
    project_key: str | None
    filters: IssueFilter
    assignee: str | None
    sort: str
    cursor: str | None
    limit: int


async def list_issues(
    services: IdentityServices, access: OrgAccess, query: ListQuery
) -> tuple[list[IssueResponse], str | None]:
    after = decode_cursor(query.cursor, query.sort) if query.cursor else None
    async with org_transaction(services, access, Permission.ORG_VIEW) as (session, current):
        filters = query.filters
        if query.assignee == "me":
            filters = replace(filters, assignee=current.user_id)
        elif query.assignee == "none":
            filters = replace(filters, unassigned=True)
        elif query.assignee is not None:
            try:
                filters = replace(filters, assignee=uuid.UUID(query.assignee))
            except ValueError as error:
                raise invalid_field(
                    "assignee", "invalid_assignee", "Use me, none or a user id."
                ) from error
        if query.project_key is not None:
            project = await projects.find_project(session, query.project_key)
            if project is None:
                return [], None  # unknown and invisible projects look the same: no rows
            filters = replace(filters, project_id=project.id)
        rows = await repository.list_issue_views(
            session,
            filters,
            all_projects=current.role in ("owner", "admin"),
            sort=query.sort,
            after=after,
            limit=query.limit + 1,
        )
        items = await issue_responses(session, rows[: query.limit])
    next_cursor = None
    if len(rows) > query.limit:
        last = rows[query.limit - 1].Issue
        column = last.updated_at if query.sort.endswith("updated_at") else last.created_at
        next_cursor = encode_cursor(query.sort, column, last.id)
    return items, next_cursor


# --------------------------------------------------------------------------- update
def _required(field: str, value: object) -> None:
    if value is None:
        raise invalid_field(field, "validation_error", "This field cannot be empty.")


def _issue_ref(project_key: str, issue: Any) -> dict[str, str]:
    return {"id": str(issue.id), "key": f"{project_key}-{issue.seq}"}


async def _hierarchy_changes(
    session: AsyncSession, project: Project, issue: Any, body: UpdateIssueRequest
) -> list[tuple[str, Any, str, Any, Any]]:
    """``type_id``/``parent_id`` validated together: the resulting kind (new or current)
    governs the resulting parent (new or current), per the hierarchy levels (plan R3.3
    row 12). Assumes the caller already required a non-null ``type_id`` if present."""
    fields = body.model_fields_set
    type_changing = "type_id" in fields
    parent_changing = "parent_id" in fields
    new_type_id = body.type_id if type_changing else issue.type_id
    new_parent_id = body.parent_id if parent_changing else issue.parent_id
    type_changed = type_changing and new_type_id != issue.type_id
    parent_changed = parent_changing and new_parent_id != issue.parent_id
    if not (type_changed or parent_changed):
        return []
    if type_changed and await repository.find_children(session, project.id, issue.id):
        raise invalid_field(
            "type_id",
            "issue_has_children",
            "Remove or re-parent its children before changing the type.",
        )
    new_type, kind = await _type_kind(session, new_type_id)  # type: ignore[arg-type]
    parent = await _validate_hierarchy(session, project.id, kind, new_parent_id, self_id=issue.id)
    changes: list[tuple[str, Any, str, Any, Any]] = []
    if type_changed:
        old_type = await repository.find_type(session, issue.type_id)
        old = {"id": str(issue.type_id), "name": old_type.name if old_type else None}
        changes.append(("type_id", new_type_id, "type", old, new_type))
    if parent_changed:
        old_parent_ref = None
        if issue.parent_id is not None:
            found = await repository.find_issue_refs(session, [issue.parent_id])
            if (old_parent := found.get(issue.parent_id)) is not None:
                old_parent_ref = {
                    "id": str(issue.parent_id),
                    "key": f"{old_parent.project_key}-{old_parent.seq}",
                }
        new_parent_ref = _issue_ref(project.key, parent) if parent is not None else None
        changes.append(("parent_id", new_parent_id, "parent", old_parent_ref, new_parent_ref))
    return changes


async def _changes(
    session: AsyncSession,
    project: Project,
    permissions: frozenset[Permission],
    issue: Any,
    body: UpdateIssueRequest,
) -> list[tuple[str, Any, str, Any, Any]]:
    """(column, new value, activity field, old activity value, new activity value) for
    each field that actually changes. ``type_id``/``parent_id`` are validated together:
    the resulting kind (new or current) governs the resulting parent (new or current),
    per the hierarchy levels (plan R3.3 row 12)."""
    fields = body.model_fields_set
    changes: list[tuple[str, Any, str, Any, Any]] = []
    if "summary" in fields:
        _required("summary", body.summary)
        if body.summary != issue.summary:
            changes.append(("summary", body.summary, "summary", issue.summary, body.summary))
    if "description" in fields:
        description = body.description or None
        if description != issue.description:
            changes.append(
                ("description", description, "description", issue.description, description)
            )
    if "type_id" in fields or "parent_id" in fields:
        if "type_id" in fields:
            _required("type_id", body.type_id)
        changes += await _hierarchy_changes(session, project, issue, body)
    if "priority_id" in fields:
        _required("priority_id", body.priority_id)
        if body.priority_id != issue.priority_id:
            new_priority = await _priority_ref(session, body.priority_id)  # type: ignore[arg-type]
            old_priority = await repository.find_priority(session, issue.priority_id)
            old = {
                "id": str(issue.priority_id),
                "name": old_priority.name if old_priority else None,
            }
            changes.append(("priority_id", body.priority_id, "priority", old, new_priority))
    if "assignee_id" in fields and body.assignee_id != issue.assignee_id:
        if Permission.ISSUE_ASSIGN not in permissions:
            raise forbidden()
        if body.assignee_id is not None:
            await _validate_assignee(session, project, body.assignee_id)
        old_assignee = {"id": str(issue.assignee_id)} if issue.assignee_id else None
        new_assignee = {"id": str(body.assignee_id)} if body.assignee_id else None
        changes.append(("assignee_id", body.assignee_id, "assignee", old_assignee, new_assignee))
    return changes


async def _label_change(
    session: AsyncSession, project: Project, issue: Any, body: UpdateIssueRequest
) -> tuple[set[uuid.UUID], set[uuid.UUID], list[Any], list[Any]] | None:
    """(labels to add, labels to remove, old refs, new refs), or ``None`` if the request
    does not touch ``label_ids`` or asks for exactly the labels already attached."""
    if "label_ids" not in body.model_fields_set:
        return None
    requested = set(body.label_ids or [])
    all_labels = await _validate_labels(session, project.id, sorted(requested))
    current = await repository.list_issue_labels(session, issue.id)
    current_ids = {label.id for label in current}
    if requested == current_ids:
        return None
    add, remove = requested - current_ids, current_ids - requested
    old_refs = [
        {"id": str(label.id), "name": label.name}
        for label in sorted(current, key=lambda label: label.name)
    ]
    new_refs = [
        {"id": str(label_id), "name": all_labels[label_id].name}
        for label_id in sorted(requested, key=lambda label_id: all_labels[label_id].name)
    ]
    return add, remove, old_refs, new_refs


async def update_issue(
    services: IdentityServices, ref: IssueRef, body: UpdateIssueRequest, expected_version: int
) -> IssueResponse:
    async with project_transaction(services, ref.project, Permission.ISSUE_EDIT) as (
        session,
        project,
        current,
    ):
        _writable(project)
        issue = await _load(session, project, ref)
        if issue.version != expected_version:
            raise version_conflict()
        changes = await _changes(session, project, current.permissions, issue, body)
        labels = await _label_change(session, project, issue, body)
        if changes or labels is not None:
            values = {column: new for column, new, _, _, _ in changes}
            if (
                await repository.update_if_version(session, issue.id, issue.version, **values)
                is None
            ):
                raise version_conflict()
            if labels is not None:
                add, remove, _, _ = labels
                await repository.set_issue_labels(
                    session, project.id, issue.id, add=add, remove=remove
                )
            entries = [
                {
                    "issue_id": issue.id,
                    "action": "updated",
                    "field": field,
                    "old_value": old,
                    "new_value": new_value,
                }
                for _, _, field, old, new_value in changes
            ]
            if labels is not None:
                _, _, old_refs, new_refs = labels
                entries.append(
                    {
                        "issue_id": issue.id,
                        "action": "updated",
                        "field": "labels",
                        "old_value": old_refs,
                        "new_value": new_refs,
                    }
                )
            await repository.add_activity(session, entries)
            for column, new_value, *_ in changes:
                if column == "assignee_id":
                    await notifications.notify(
                        session,
                        project_id=project.id,
                        issue_id=issue.id,
                        kind="issue_assigned",
                        candidates=[new_value],
                        payload={"summary": issue.summary},
                    )
        return await _issue_response(session, issue.id)


# --------------------------------------------------------------------------- delete
async def delete_issue(services: IdentityServices, ref: IssueRef, client: ClientInfo) -> None:
    """Soft delete (project admins; org owners/admins). A standard issue's sub-tasks are
    soft-deleted with it; an epic's children are detached instead (plan M7 AC)."""
    async with project_transaction(services, ref.project, Permission.ISSUE_DELETE) as (
        session,
        project,
        current,
    ):
        _writable(project)
        issue = await _load(session, project, ref)
        issue_type = await repository.find_type(session, issue.type_id)
        if not await repository.soft_delete(session, issue.id, issue.version):
            raise version_conflict()
        entries = [{"issue_id": issue.id, "action": "deleted"}]
        self_ref = _issue_ref(project.key, issue)
        if issue_type is not None and issue_type.kind == "standard":
            cascaded = await repository.cascade_soft_delete_children(session, project.id, issue.id)
            entries += [
                {
                    "issue_id": child_id,
                    "action": "deleted",
                    "field": "parent",
                    "old_value": self_ref,
                }
                for child_id in cascaded
            ]
        elif issue_type is not None and issue_type.kind == "epic":
            detached = await repository.detach_children(session, project.id, issue.id)
            entries += [
                {
                    "issue_id": child_id,
                    "action": "updated",
                    "field": "parent",
                    "old_value": self_ref,
                    "new_value": None,
                }
                for child_id in detached
            ]
        await repository.add_activity(session, entries)
        await audit.record(
            session,
            "issue.deleted",
            client,
            actor_user_id=current.org.user_id,
            target_type="issue",
            target_id=str(issue.id),
            metadata={"key": ref.key},
        )


# ---------------------------------------------------------------------- hierarchy
async def list_children(services: IdentityServices, ref: IssueRef) -> list[IssueResponse]:
    async with project_transaction(services, ref.project, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        issue = await _load(session, project, ref)
        children = await repository.find_children(session, project.id, issue.id)
        rows = await repository.issue_views_by_ids(session, [c.id for c in children])
        return await issue_responses(session, rows)


# --------------------------------------------------------------------- transitions
async def list_available_transitions(
    services: IdentityServices, ref: IssueRef
) -> list[TransitionRef]:
    async with project_transaction(services, ref.project, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        issue = await _load(session, project, ref)
        transitions = await repository.list_transitions(
            session, project.workflow_id, issue.status_id
        )
        statuses = await repository.find_statuses(
            session, [transition.to_status_id for transition in transitions]
        )
    return [
        TransitionRef(
            id=transition.id,
            name=transition.name,
            to_status=StatusRef(id=status.id, name=status.name, category=status.category),
        )
        for transition in transitions
        if (status := statuses.get(transition.to_status_id)) is not None
    ]


async def _notify_status_change(
    session: AsyncSession, project: Project, issue: Any, old_name: str | None, new_name: str
) -> None:
    await notifications.notify(
        session,
        project_id=project.id,
        issue_id=issue.id,
        kind="issue_status_changed",
        candidates=[issue.reporter_id, issue.assignee_id],
        payload={"summary": issue.summary, "from": old_name, "to": new_name},
    )


def invalid_transition() -> AppError:
    return AppError(422, "invalid_transition", "Unknown transition for this issue.")


def transition_not_permitted() -> AppError:
    return AppError(
        422,
        "transition_not_permitted",
        "This transition is not available from the issue's current status.",
    )


async def apply_transition(
    services: IdentityServices, ref: IssueRef, body: ApplyTransitionRequest, expected_version: int
) -> IssueResponse:
    async with project_transaction(services, ref.project, Permission.ISSUE_TRANSITION) as (
        session,
        project,
        _,
    ):
        _writable(project)
        issue = await _load(session, project, ref)
        if issue.version != expected_version:
            raise version_conflict()
        transition = await repository.find_transition(
            session, project.workflow_id, body.transition_id
        )
        if transition is None:
            raise invalid_transition()
        if transition.from_status_id is not None and transition.from_status_id != issue.status_id:
            raise transition_not_permitted()
        statuses = await repository.find_statuses(
            session, [issue.status_id, transition.to_status_id]
        )
        old_status, new_status = statuses.get(issue.status_id), statuses[transition.to_status_id]
        if (
            await repository.set_status(
                session,
                issue.id,
                issue.version,
                transition.to_status_id,
                mark_done=new_status.category == "done",
            )
            is None
        ):
            raise version_conflict()
        await repository.add_activity(
            session,
            [
                {
                    "issue_id": issue.id,
                    "action": "transitioned",
                    "field": "status",
                    "old_value": {"id": str(issue.status_id), "name": old_status.name}
                    if old_status
                    else None,
                    "new_value": {"id": str(transition.to_status_id), "name": new_status.name},
                }
            ],
        )
        await _notify_status_change(
            session, project, issue, old_status.name if old_status else None, new_status.name
        )
        return await _issue_response(session, issue.id)


def invalid_position() -> AppError:
    return AppError(
        422,
        "invalid_position",
        "The neighbouring issues no longer match the board; refresh and try again.",
    )


async def _neighbour(
    session: AsyncSession, project: Project, issue: Any, key: str | None
) -> Any | None:
    if key is None:
        return None
    prefix, _, number = key.rpartition("-")
    found = (
        await repository.find_issues_by_seq(session, project.id, [int(number)])
        if prefix == project.key
        else {}
    )
    neighbour = found.get(int(number)) if found else None
    if neighbour is None or neighbour.id == issue.id:
        raise invalid_position()
    return neighbour


async def _check_status_move(
    session: AsyncSession, project: Project, issue: Any, target_id: uuid.UUID
) -> dict[uuid.UUID, Any]:
    statuses = await repository.find_statuses(session, [issue.status_id, target_id])
    if target_id not in statuses:
        raise invalid_transition()
    allowed = await repository.list_transitions(session, project.workflow_id, issue.status_id)
    if all(transition.to_status_id != target_id for transition in allowed):
        raise transition_not_permitted()
    return statuses


async def _lock_target_sprint(
    session: AsyncSession, project: Project, sprint_id: uuid.UUID | None
) -> Any | None:
    if sprint_id is None:
        return None
    sprint = await sprints.find_sprint(session, project.id, sprint_id, lock="share")
    if sprint is None:
        raise AppError(422, "invalid_sprint", "Unknown sprint for this project.")
    if sprint.state == "closed":
        raise AppError(409, "sprint_closed", "This sprint is closed.")
    return sprint


async def _move_rank(
    session: AsyncSession,
    project: Project,
    issue: Any,
    body: MoveIssueRequest,
    *,
    target_id: uuid.UUID,
    changes_sprint: bool,
) -> str:
    above = await _neighbour(session, project, issue, body.after_key)
    below = await _neighbour(session, project, issue, body.before_key)
    if above is not None and below is not None and above.rank >= below.rank:
        raise invalid_position()
    if above is None and below is None:
        if changes_sprint:
            last = await repository.last_rank_in_sprint(
                session, project.id, body.sprint_id, issue.id
            )
        else:
            last = await repository.last_rank_in_status(session, project.id, target_id, issue.id)
        return ranking.between(last, None)
    return ranking.between(
        above.rank if above is not None else None, below.rank if below is not None else None
    )


def _status_activity(issue: Any, new_status: Any, old_status: Any | None) -> dict[str, Any]:
    return {
        "issue_id": issue.id,
        "action": "transitioned",
        "field": "status",
        "old_value": {"id": str(issue.status_id), "name": old_status.name} if old_status else None,
        "new_value": {"id": str(new_status.id), "name": new_status.name},
    }


def _sprint_activity(issue: Any, old_sprint: Any | None, new_sprint: Any | None) -> dict[str, Any]:
    return {
        "issue_id": issue.id,
        "action": "sprint_changed",
        "field": "sprint",
        "old_value": {"id": str(old_sprint.id), "name": old_sprint.name} if old_sprint else None,
        "new_value": {"id": str(new_sprint.id), "name": new_sprint.name} if new_sprint else None,
    }


async def move_issue(
    services: IdentityServices,
    ref: IssueRef,
    body: MoveIssueRequest,
    expected_version: int | None,
) -> IssueResponse:
    """Atomic board/backlog move (plan §3): status change (workflow-checked), sprint change
    (sprint locked ``FOR SHARE``, never ``closed``) and rank in one transaction. A pure
    reorder needs no ``If-Match`` and never bumps ``version``; a status or sprint change
    does both."""
    async with project_transaction(services, ref.project, Permission.ISSUE_TRANSITION) as (
        session,
        project,
        current,
    ):
        _writable(project)
        issue = await _load(session, project, ref)
        target_id = body.to_status_id or issue.status_id
        changes_status = target_id != issue.status_id
        changes_sprint = "sprint_id" in body.model_fields_set and body.sprint_id != issue.sprint_id
        if expected_version is not None and issue.version != expected_version:
            raise version_conflict()
        if (changes_status or changes_sprint) and expected_version is None:
            raise AppError(
                428,
                "precondition_required",
                'Send If-Match with the issue\'s ETag ("v<version>") to change status or sprint.',
            )
        if changes_sprint and Permission.ISSUE_EDIT not in current.permissions:
            raise forbidden()
        statuses = (
            await _check_status_move(session, project, issue, target_id) if changes_status else {}
        )
        new_sprint = (
            await _lock_target_sprint(session, project, body.sprint_id) if changes_sprint else None
        )
        new_rank = await _move_rank(
            session, project, issue, body, target_id=target_id, changes_sprint=changes_sprint
        )
        if changes_status or changes_sprint:
            values: dict[str, Any] = {"rank": new_rank}
            activity: list[dict[str, Any]] = []
            if changes_status:
                new_status = statuses[target_id]
                values["status_id"] = target_id
                values["done_at"] = func.now() if new_status.category == "done" else None
                activity.append(_status_activity(issue, new_status, statuses.get(issue.status_id)))
            if changes_sprint:
                old_sprint = (
                    await sprints.find_sprint(session, project.id, issue.sprint_id)
                    if issue.sprint_id
                    else None
                )
                values["sprint_id"] = body.sprint_id
                activity.append(_sprint_activity(issue, old_sprint, new_sprint))
            if (
                await repository.update_if_version(session, issue.id, issue.version, **values)
                is None
            ):
                raise version_conflict()
            await repository.add_activity(session, activity)
            if changes_status:
                old_status = statuses.get(issue.status_id)
                await _notify_status_change(
                    session,
                    project,
                    issue,
                    old_status.name if old_status else None,
                    statuses[target_id].name,
                )
        elif not await repository.set_rank(session, issue.id, new_rank):
            raise not_found()
        if ranking.needs_rebalance(new_rank):
            await repository.rebalance_project_ranks(session, project.id)
        return await _issue_response(session, issue.id)


# ------------------------------------------------------------------------- activity
async def list_activity(
    services: IdentityServices, ref: IssueRef, cursor: str | None, limit: int
) -> tuple[list[ActivityResponse], str | None]:
    after = _decode_activity_cursor(cursor) if cursor else None
    async with project_transaction(services, ref.project, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        issue = await _load(session, project, ref)
        rows = await repository.list_activity(session, issue.id, after_id=after, limit=limit + 1)
        users = await visible_users(
            session, sorted({r.actor_id for r in rows[:limit] if r.actor_id})
        )
    items = [
        ActivityResponse(
            id=r.id,
            actor=_user(users, r.actor_id),
            action=r.action,
            field=r.field,
            old_value=r.old_value,
            new_value=r.new_value,
            created_at=r.created_at,
        )
        for r in rows[:limit]
    ]
    next_cursor = None
    if len(rows) > limit:
        next_cursor = base64.urlsafe_b64encode(str(rows[limit - 1].id).encode()).decode()
    return items, next_cursor


def _decode_activity_cursor(cursor: str) -> int:
    try:
        value = int(base64.urlsafe_b64decode(cursor.encode()).decode())
    except (ValueError, binascii.Error) as error:
        raise invalid_cursor() from error
    if value < 0:
        raise invalid_cursor()
    return value


# ----------------------------------------------------------------------------- labels
async def list_labels(services: IdentityServices, access: ProjectAccess) -> list[Label]:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        return await repository.list_labels(session, project.id)


def label_name_taken() -> AppError:
    return AppError(
        409,
        "label_name_taken",
        "This label name is already used in the project.",
        errors=[{"field": "body.name", "message": "is already used"}],
    )


async def create_label(
    services: IdentityServices, access: ProjectAccess, *, name: str, color: str
) -> LabelResponse:
    label_id = uuid.uuid4()
    try:
        async with project_transaction(services, access, Permission.PROJECT_MANAGE) as (
            session,
            project,
            _,
        ):
            await repository.create_label(session, label_id, project.id, name, color)
    except IntegrityError as error:
        if "uq_labels_project_id_name" in str(error.orig):
            raise label_name_taken() from None
        raise
    return LabelResponse(id=label_id, name=name, color=color)


async def delete_label(
    services: IdentityServices, access: ProjectAccess, *, label_id: uuid.UUID
) -> None:
    async with project_transaction(services, access, Permission.PROJECT_MANAGE) as (
        session,
        project,
        _,
    ):
        if not await repository.delete_label(session, project.id, label_id):
            raise not_found()
