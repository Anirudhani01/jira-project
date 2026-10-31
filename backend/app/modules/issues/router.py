"""Issue HTTP API (M6/M7). All routes are org-scoped and permission-tagged; issue routes
resolve the project through the caller's access, so invisible projects are 404."""

import re
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Header, Query, Request, Response, status

from app.authz.deps import OrgAccess, require
from app.authz.issues import IssueRef, require_issue
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, require_project
from app.core.errors import AppError
from app.modules.identity.deps import CsrfProtected, Services, client_info
from app.modules.issues import bulk, service
from app.modules.issues.repository import IssueFilter
from app.modules.issues.schemas import (
    ActivityListResponse,
    ApplyTransitionRequest,
    BulkIssueRequest,
    BulkIssueResponse,
    ChildrenResponse,
    CreateIssueRequest,
    CreateLabelRequest,
    EpicListResponse,
    IssueListResponse,
    IssueResponse,
    LabelListResponse,
    LabelResponse,
    MoveIssueRequest,
    SortOrder,
    StatusCategory,
    TransitionListResponse,
    UpdateIssueRequest,
)

router = APIRouter(prefix="/api/v1/orgs/{org_slug}", tags=["issues"])

ViewOrg = Annotated[OrgAccess, require(Permission.ORG_VIEW)]
CreateIssues = Annotated[ProjectAccess, require_project(Permission.ISSUE_CREATE)]
ViewProjectLabels = Annotated[ProjectAccess, require_project(Permission.PROJECT_VIEW)]
ManageProjectLabels = Annotated[ProjectAccess, require_project(Permission.PROJECT_MANAGE)]
ViewIssue = Annotated[IssueRef, require_issue(Permission.PROJECT_VIEW)]
EditIssue = Annotated[IssueRef, require_issue(Permission.ISSUE_EDIT)]
DeleteIssue = Annotated[IssueRef, require_issue(Permission.ISSUE_DELETE)]
TransitionIssue = Annotated[IssueRef, require_issue(Permission.ISSUE_TRANSITION)]

IDEMPOTENCY_KEY = re.compile(r"[A-Za-z0-9_.:-]{1,64}")
ETAG = re.compile(r'"v([1-9][0-9]{0,9})"')


def _etag(issue: IssueResponse) -> str:
    return f'"v{issue.version}"'


def _location(slug: str, issue: IssueResponse) -> str:
    return f"/api/v1/orgs/{slug}/issues/{issue.key}"


@router.post(
    "/projects/{project_key}/issues",
    status_code=status.HTTP_201_CREATED,
    response_model=IssueResponse,
    dependencies=[CsrfProtected],
)
async def create_issue(
    body: CreateIssueRequest,
    response: Response,
    access: CreateIssues,
    services: Services,
    idempotency_key: Annotated[str | None, Header()] = None,
) -> IssueResponse:
    """Creates ``KEY-n`` in the project's initial status. ``Idempotency-Key`` (optional):
    a retry with the same key and body replays the original response."""
    if idempotency_key is not None and not IDEMPOTENCY_KEY.fullmatch(idempotency_key):
        raise AppError(
            422,
            "validation_error",
            "Idempotency-Key must be 1-64 characters: letters, digits, _ . : -",
            errors=[{"field": "header.idempotency-key", "message": "invalid format"}],
        )
    created = await service.create_issue(services, access, body, idempotency_key)
    response.headers["ETag"] = _etag(created.issue)
    response.headers["Location"] = _location(access.org.slug, created.issue)
    return created.issue


@router.get("/issues", response_model=IssueListResponse)
async def list_issues(
    access: ViewOrg,
    services: Services,
    *,
    project: Annotated[str | None, Query(max_length=10)] = None,
    status_id: Annotated[uuid.UUID | None, Query(alias="status")] = None,
    status_category: StatusCategory | None = None,
    type_id: Annotated[uuid.UUID | None, Query(alias="type")] = None,
    priority_id: Annotated[uuid.UUID | None, Query(alias="priority")] = None,
    assignee: Annotated[str | None, Query(max_length=36)] = None,
    label: Annotated[uuid.UUID | None, Query()] = None,
    sprint: Annotated[str | None, Query(max_length=36)] = None,
    updated_since: datetime | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    sort: SortOrder = "-updated_at",
    cursor: Annotated[str | None, Query(max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> IssueListResponse:
    """Issues of the projects the caller can view, filters combined with AND."""
    sprint_id: uuid.UUID | None = None
    backlog_only = False
    if sprint is not None:
        sprint_value = sprint.strip().lower()
        if sprint_value == "backlog":
            backlog_only = True
        elif sprint_value:
            try:
                sprint_id = uuid.UUID(sprint_value)
            except ValueError as error:
                raise service.invalid_field(
                    "sprint", "invalid_sprint", "Use backlog or a sprint id."
                ) from error
    items, next_cursor = await service.list_issues(
        services,
        access,
        service.ListQuery(
            project_key=project.upper() if project else None,
            filters=IssueFilter(
                status_id=status_id,
                status_category=status_category,
                type_id=type_id,
                priority_id=priority_id,
                label_id=label,
                sprint_id=sprint_id,
                backlog_only=backlog_only,
                updated_since=updated_since,
                q=q.strip() if q and q.strip() else None,
            ),
            assignee=assignee,
            sort=sort,
            cursor=cursor,
            limit=limit,
        ),
    )
    return IssueListResponse(items=items, next_cursor=next_cursor)


@router.post("/issues/bulk", response_model=BulkIssueResponse, dependencies=[CsrfProtected])
async def bulk_change(
    body: BulkIssueRequest, access: ViewOrg, services: Services, request: Request
) -> BulkIssueResponse:
    """Applies one action to up to 100 issues; each item is checked and applied on its own
    and reported in ``results`` (some may fail while others succeed)."""
    return await bulk.bulk_change(services, access, body, client_info(request))


@router.get("/issues/{issue_key}", response_model=IssueResponse)
async def get_issue(ref: ViewIssue, response: Response, services: Services) -> IssueResponse:
    issue = await service.get_issue(services, ref)
    response.headers["ETag"] = _etag(issue)
    return issue


@router.patch("/issues/{issue_key}", response_model=IssueResponse, dependencies=[CsrfProtected])
async def update_issue(
    body: UpdateIssueRequest,
    ref: EditIssue,
    response: Response,
    services: Services,
    if_match: Annotated[str | None, Header()] = None,
) -> IssueResponse:
    """Requires ``If-Match: "v<version>"`` (428 if missing, 412 if stale)."""
    if if_match is None:
        raise AppError(
            428, "precondition_required", 'Send If-Match with the issue\'s ETag ("v<version>").'
        )
    match = ETAG.fullmatch(if_match.strip())
    if match is None:
        raise service.version_conflict()
    if not body.model_fields_set:
        raise AppError(422, "validation_error", "Nothing to update.")
    issue = await service.update_issue(services, ref, body, int(match.group(1)))
    response.headers["ETag"] = _etag(issue)
    return issue


@router.delete(
    "/issues/{issue_key}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfProtected]
)
async def delete_issue(ref: DeleteIssue, request: Request, services: Services) -> Response:
    await service.delete_issue(services, ref, client_info(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/issues/{issue_key}/activity", response_model=ActivityListResponse)
async def list_activity(
    ref: ViewIssue,
    services: Services,
    cursor: Annotated[str | None, Query(max_length=64)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> ActivityListResponse:
    items, next_cursor = await service.list_activity(services, ref, cursor, limit)
    return ActivityListResponse(items=items, next_cursor=next_cursor)


@router.get("/issues/{issue_key}/children", response_model=ChildrenResponse)
async def list_children(ref: ViewIssue, services: Services) -> ChildrenResponse:
    """Direct children only: a sub-task has none; a standard issue's are sub-tasks; an
    epic's are standard issues (plan M7)."""
    return await service.list_children(services, ref)


@router.get("/issues/{issue_key}/transitions", response_model=TransitionListResponse)
async def list_transitions(ref: ViewIssue, services: Services) -> TransitionListResponse:
    """Transitions permitted from the issue's current status."""
    return TransitionListResponse(items=await service.list_available_transitions(services, ref))


@router.post(
    "/issues/{issue_key}/transitions",
    response_model=IssueResponse,
    dependencies=[CsrfProtected],
)
async def apply_transition(
    body: ApplyTransitionRequest,
    ref: TransitionIssue,
    response: Response,
    services: Services,
    if_match: Annotated[str | None, Header()] = None,
) -> IssueResponse:
    """Requires ``If-Match: "v<version>"``, exactly like ``PATCH`` (428/412)."""
    if if_match is None:
        raise AppError(
            428, "precondition_required", 'Send If-Match with the issue\'s ETag ("v<version>").'
        )
    match = ETAG.fullmatch(if_match.strip())
    if match is None:
        raise service.version_conflict()
    issue = await service.apply_transition(services, ref, body, int(match.group(1)))
    response.headers["ETag"] = _etag(issue)
    return issue


@router.post(
    "/issues/{issue_key}/move",
    response_model=IssueResponse,
    dependencies=[CsrfProtected],
)
async def move_issue(
    body: MoveIssueRequest,
    ref: TransitionIssue,
    response: Response,
    services: Services,
    if_match: Annotated[str | None, Header()] = None,
) -> IssueResponse:
    """Board move: status change (needs ``If-Match``) and/or reorder (does not)."""
    expected: int | None = None
    if if_match is not None:
        match = ETAG.fullmatch(if_match.strip())
        if match is None:
            raise service.version_conflict()
        expected = int(match.group(1))
    issue = await service.move_issue(services, ref, body, expected)
    response.headers["ETag"] = _etag(issue)
    return issue


@router.get("/projects/{project_key}/epics", response_model=EpicListResponse)
async def list_epics(
    access: ViewProjectLabels, services: Services, include_done: bool = False
) -> EpicListResponse:
    """Epics with child progress; epics in a done status are hidden unless asked for."""
    return await service.list_epics(services, access, include_done=include_done)


@router.get("/projects/{project_key}/labels", response_model=LabelListResponse)
async def list_labels(access: ViewProjectLabels, services: Services) -> LabelListResponse:
    items = await service.list_labels(services, access)
    return LabelListResponse(
        items=[LabelResponse(id=label.id, name=label.name, color=label.color) for label in items]
    )


@router.post(
    "/projects/{project_key}/labels",
    status_code=status.HTTP_201_CREATED,
    response_model=LabelResponse,
    dependencies=[CsrfProtected],
)
async def create_label(
    body: CreateLabelRequest, access: ManageProjectLabels, services: Services
) -> LabelResponse:
    return await service.create_label(services, access, name=body.name, color=body.color)


@router.delete(
    "/projects/{project_key}/labels/{label_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def delete_label(
    label_id: uuid.UUID, access: ManageProjectLabels, services: Services
) -> Response:
    await service.delete_label(services, access, label_id=label_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
