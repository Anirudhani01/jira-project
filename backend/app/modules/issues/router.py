"""Issue HTTP API (M6). All routes are org-scoped and permission-tagged; issue routes
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
from app.modules.issues import service
from app.modules.issues.repository import IssueFilter
from app.modules.issues.schemas import (
    ActivityListResponse,
    CreateIssueRequest,
    IssueListResponse,
    IssueResponse,
    SortOrder,
    StatusCategory,
    UpdateIssueRequest,
)

router = APIRouter(prefix="/api/v1/orgs/{org_slug}", tags=["issues"])

ViewOrg = Annotated[OrgAccess, require(Permission.ORG_VIEW)]
CreateIssues = Annotated[ProjectAccess, require_project(Permission.ISSUE_CREATE)]
ViewIssue = Annotated[IssueRef, require_issue(Permission.PROJECT_VIEW)]
EditIssue = Annotated[IssueRef, require_issue(Permission.ISSUE_EDIT)]
DeleteIssue = Annotated[IssueRef, require_issue(Permission.ISSUE_DELETE)]

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
    updated_since: datetime | None = None,
    sort: SortOrder = "-updated_at",
    cursor: Annotated[str | None, Query(max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> IssueListResponse:
    """Issues of the projects the caller can view, filters combined with AND."""
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
                updated_since=updated_since,
            ),
            assignee=assignee,
            sort=sort,
            cursor=cursor,
            limit=limit,
        ),
    )
    return IssueListResponse(items=items, next_cursor=next_cursor)


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
