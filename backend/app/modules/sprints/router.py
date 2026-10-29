"""Sprint and backlog HTTP API (M10). Moving an issue between sprints/backlog is
``POST /issues/{key}/move`` (issues router) with ``sprint_id``."""

from typing import Annotated

from fastapi import APIRouter, Request, Response, status

from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, require_project
from app.authz.sprints import SprintRef, require_sprint
from app.modules.identity.deps import CsrfProtected, Services, client_info
from app.modules.sprints import service
from app.modules.sprints.schemas import (
    BacklogResponse,
    CompleteSprintRequest,
    CompleteSprintResponse,
    CreateSprintRequest,
    SprintListResponse,
    SprintResponse,
    StartSprintRequest,
    UpdateSprintRequest,
)

router = APIRouter(prefix="/api/v1/orgs/{org_slug}", tags=["sprints"])

ViewProject = Annotated[ProjectAccess, require_project(Permission.PROJECT_VIEW)]
ManageSprints = Annotated[ProjectAccess, require_project(Permission.SPRINT_MANAGE)]
ManageSprint = Annotated[SprintRef, require_sprint(Permission.SPRINT_MANAGE)]


@router.get("/projects/{project_key}/sprints", response_model=SprintListResponse)
async def list_sprints(access: ViewProject, services: Services) -> SprintListResponse:
    return await service.list_sprints(services, access)


@router.post(
    "/projects/{project_key}/sprints",
    response_model=SprintResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CsrfProtected],
)
async def create_sprint(
    body: CreateSprintRequest, access: ManageSprints, services: Services
) -> SprintResponse:
    return await service.create_sprint(services, access, body)


@router.get("/projects/{project_key}/backlog", response_model=BacklogResponse)
async def get_backlog(access: ViewProject, services: Services) -> BacklogResponse:
    return await service.get_backlog(services, access)


@router.patch("/sprints/{sprint_id}", response_model=SprintResponse, dependencies=[CsrfProtected])
async def update_sprint(
    body: UpdateSprintRequest, ref: ManageSprint, services: Services
) -> SprintResponse:
    return await service.update_sprint(services, ref, body)


@router.delete(
    "/sprints/{sprint_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def delete_sprint(ref: ManageSprint, services: Services) -> Response:
    await service.delete_sprint(services, ref)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/sprints/{sprint_id}/start", response_model=SprintResponse, dependencies=[CsrfProtected]
)
async def start_sprint(
    body: StartSprintRequest, ref: ManageSprint, services: Services, request: Request
) -> SprintResponse:
    return await service.start_sprint(services, ref, body, client_info(request))


@router.post(
    "/sprints/{sprint_id}/complete",
    response_model=CompleteSprintResponse,
    dependencies=[CsrfProtected],
)
async def complete_sprint(
    body: CompleteSprintRequest, ref: ManageSprint, services: Services, request: Request
) -> CompleteSprintResponse:
    return await service.complete_sprint(services, ref, body, client_info(request))
