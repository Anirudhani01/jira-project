"""Issue use cases (plan M6, R4, R7-M6).

- Every operation runs in ONE transaction that re-checks the caller's project access
  (``project_transaction``); issues of projects the caller cannot view are 404, exactly
  like unknown issues (organization membership alone grants nothing).
- Create: optional ``Idempotency-Key`` claimed first; issue number allocated from
  ``project_issue_counters`` as the last step before the insert, so a failed create never
  consumes a number; the ``created`` activity row is written in the same transaction.
- Update: requires the version the client last saw (``If-Match``); conditional update
  bumps ``version``; one activity row per changed field, same transaction.
- M6 edits only summary, description, type and priority; sub-task issues need a parent
  (M7) and are rejected for now.
"""

import base64
import binascii
import hashlib
import json
import uuid
from dataclasses import dataclass, replace
from datetime import datetime
from typing import Any

from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.authz.deps import OrgAccess, not_found, org_transaction
from app.authz.issues import IssueRef
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.identity.directory import visible_users
from app.modules.issues import repository
from app.modules.issues.repository import IssueFilter, NewIssue
from app.modules.issues.schemas import (
    ActivityResponse,
    CreateIssueRequest,
    IssueResponse,
    PriorityRef,
    StatusRef,
    TypeRef,
    UpdateIssueRequest,
    UserRef,
)
from app.modules.projects import repository as projects
from app.modules.projects.models import Project
from app.modules.projects.service import project_archived
from app.modules.security_events.service import ClientInfo

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


def _response(row: Any, users: dict[uuid.UUID, Any]) -> IssueResponse:
    issue = row.Issue
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
        version=issue.version,
        created_at=issue.created_at,
        updated_at=issue.updated_at,
    )


async def _responses(session: AsyncSession, rows: list[Any]) -> list[IssueResponse]:
    ids = {r.Issue.reporter_id for r in rows} | {
        r.Issue.assignee_id for r in rows if r.Issue.assignee_id
    }
    users = await visible_users(session, sorted(ids))
    return [_response(r, users) for r in rows]


async def _issue_response(session: AsyncSession, issue_id: uuid.UUID) -> IssueResponse:
    [response] = await _responses(session, [await repository.issue_view(session, issue_id)])
    return response


# ---------------------------------------------------------------------- validation
async def _type_ref(session: AsyncSession, type_id: uuid.UUID) -> dict[str, str]:
    issue_type = await repository.find_type(session, type_id)
    if issue_type is None:
        raise invalid_field("type_id", "invalid_type", "Unknown issue type.")
    if issue_type.kind == "subtask":  # needs a parent; hierarchy arrives in M7
        raise invalid_field(
            "type_id", "subtask_requires_parent", "Sub-tasks can only be created under a parent."
        )
    return {"id": str(issue_type.id), "name": issue_type.name}


async def _priority_ref(session: AsyncSession, priority_id: uuid.UUID) -> dict[str, str]:
    priority = await repository.find_priority(session, priority_id)
    if priority is None:
        raise invalid_field("priority_id", "invalid_priority", "Unknown priority.")
    return {"id": str(priority.id), "name": priority.name}


def _writable(project: Project) -> None:
    if project.archived_at is not None:
        raise project_archived()


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
            type_ref = await _type_ref(session, body.type_id)
            await _priority_ref(session, body.priority_id)
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
                ),
            )
            await repository.add_activity(
                session,
                [{"issue_id": issue_id, "action": "created", "new_value": {"type": type_ref}}],
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
        items = await _responses(session, rows[: query.limit])
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


async def _changes(
    session: AsyncSession, issue: Any, body: UpdateIssueRequest
) -> list[tuple[str, Any, str, Any, Any]]:
    """(column, new value, activity field, old activity value, new activity value) for
    each field that actually changes."""
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
    if "type_id" in fields:
        _required("type_id", body.type_id)
        if body.type_id != issue.type_id:
            new_type = await _type_ref(session, body.type_id)  # type: ignore[arg-type]
            old_type = await repository.find_type(session, issue.type_id)
            old = {"id": str(issue.type_id), "name": old_type.name if old_type else None}
            changes.append(("type_id", body.type_id, "type", old, new_type))
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
    return changes


async def update_issue(
    services: IdentityServices, ref: IssueRef, body: UpdateIssueRequest, expected_version: int
) -> IssueResponse:
    async with project_transaction(services, ref.project, Permission.ISSUE_EDIT) as (
        session,
        project,
        _,
    ):
        _writable(project)
        issue = await _load(session, project, ref)
        if issue.version != expected_version:
            raise version_conflict()
        changes = await _changes(session, issue, body)
        if changes:
            values = {column: new for column, new, _, _, _ in changes}
            if (
                await repository.update_if_version(session, issue.id, issue.version, **values)
                is None
            ):
                raise version_conflict()
            await repository.add_activity(
                session,
                [
                    {
                        "issue_id": issue.id,
                        "action": "updated",
                        "field": field,
                        "old_value": old,
                        "new_value": new_value,
                    }
                    for _, _, field, old, new_value in changes
                ],
            )
        return await _issue_response(session, issue.id)


# --------------------------------------------------------------------------- delete
async def delete_issue(services: IdentityServices, ref: IssueRef, client: ClientInfo) -> None:
    """Soft delete (project admins; org owners/admins). Sub-task/epic cascades: M7."""
    async with project_transaction(services, ref.project, Permission.ISSUE_DELETE) as (
        session,
        project,
        current,
    ):
        _writable(project)
        issue = await _load(session, project, ref)
        if not await repository.soft_delete(session, issue.id, issue.version):
            raise version_conflict()
        await repository.add_activity(session, [{"issue_id": issue.id, "action": "deleted"}])
        await audit.record(
            session,
            "issue.deleted",
            client,
            actor_user_id=current.org.user_id,
            target_type="issue",
            target_id=str(issue.id),
            metadata={"key": ref.key},
        )


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
