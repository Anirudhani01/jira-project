"""Project HTTP API (M5). All routes are org-scoped and permission-tagged."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from app.authz.deps import OrgAccess, require
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, require_project
from app.core.errors import AppError
from app.modules.identity.deps import CsrfProtected, Services, client_info
from app.modules.projects import service
from app.modules.projects.models import Project
from app.modules.projects.schemas import (
    AddProjectMemberRequest,
    ColumnResponse,
    CreateProjectRequest,
    ProjectListResponse,
    ProjectMemberListResponse,
    ProjectMemberResponse,
    ProjectResponse,
    ProjectSummary,
    StatusResponse,
    TransitionResponse,
    UpdateProjectMemberRequest,
    UpdateProjectRequest,
    WorkflowResponse,
)

router = APIRouter(prefix="/api/v1/orgs/{org_slug}/projects", tags=["projects"])

ViewOrg = Annotated[OrgAccess, require(Permission.ORG_VIEW)]
CreateProjects = Annotated[OrgAccess, require(Permission.PROJECT_CREATE)]
ViewProject = Annotated[ProjectAccess, require_project(Permission.PROJECT_VIEW)]
ManageProject = Annotated[ProjectAccess, require_project(Permission.PROJECT_MANAGE)]
ManageProjectMembers = Annotated[ProjectAccess, require_project(Permission.PROJECT_MEMBERS_MANAGE)]


def _project(project: Project, access: ProjectAccess) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        key=project.key,
        name=project.name,
        description=project.description,
        board_type=project.board_type,
        archived=project.archived_at is not None,
        my_role=access.project_role,
        permissions=sorted(p.value for p in access.permissions),
        created_at=project.created_at,
    )


@router.get("", response_model=ProjectListResponse)
async def list_projects(
    access: ViewOrg, services: Services, archived: Annotated[bool, Query()] = False
) -> ProjectListResponse:
    """Projects the caller can view (all of them for org owners/admins)."""
    rows = await service.list_projects(services, access, archived=archived)
    return ProjectListResponse(
        items=[
            ProjectSummary(
                key=p.key,
                name=p.name,
                board_type=p.board_type,
                archived=p.archived_at is not None,
                my_role=role,
            )
            for p, role in rows
        ]
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    response_model=ProjectSummary,
    dependencies=[CsrfProtected],
)
async def create_project(
    body: CreateProjectRequest,
    request: Request,
    response: Response,
    access: CreateProjects,
    services: Services,
) -> ProjectSummary:
    """Org owners/admins, or members explicitly granted project creation (D9 Option B)."""
    await service.create_project(
        services,
        access,
        key=body.key,
        name=body.name,
        description=body.description,
        board_type=body.board_type,
        client=client_info(request),
    )
    response.headers["Location"] = f"/api/v1/orgs/{access.slug}/projects/{body.key}"
    return ProjectSummary(
        key=body.key, name=body.name, board_type=body.board_type, archived=False, my_role="admin"
    )


@router.get("/{project_key}", response_model=ProjectResponse)
async def get_project(access: ViewProject, services: Services) -> ProjectResponse:
    project, current = await service.get_project(services, access)
    return _project(project, current)


@router.patch("/{project_key}", response_model=ProjectResponse, dependencies=[CsrfProtected])
async def update_project(
    body: UpdateProjectRequest, request: Request, access: ManageProject, services: Services
) -> ProjectResponse:
    if body.key is not None:
        raise AppError(
            422,
            "field_immutable",
            "The project key cannot be changed.",
            errors=[{"field": "body.key", "message": "cannot be changed"}],
        )
    await service.update_project(
        services,
        access,
        name=body.name,
        description=body.description,
        clear_description="description" in body.model_fields_set and body.description is None,
        client=client_info(request),
    )
    project, current = await service.get_project(services, access)
    return _project(project, current)


@router.post(
    "/{project_key}/archive", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfProtected]
)
async def archive_project(request: Request, access: ManageProject, services: Services) -> Response:
    await service.set_archived(services, access, archived=True, client=client_info(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/{project_key}/unarchive",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def unarchive_project(
    request: Request, access: ManageProject, services: Services
) -> Response:
    await service.set_archived(services, access, archived=False, client=client_info(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_key}/workflow", response_model=WorkflowResponse)
async def get_workflow(access: ViewProject, services: Services) -> WorkflowResponse:
    """Read-only in the MVP: statuses, transitions and the board's default columns."""
    view = await service.workflow(services, access)
    return WorkflowResponse(
        name=view["name"],
        initial_status_id=view["initial_status_id"],
        statuses=[
            StatusResponse(id=s.id, name=s.name, category=s.category, position=s.position)
            for s in view["statuses"]  # type: ignore[attr-defined]
        ],
        transitions=[
            TransitionResponse(
                id=t.id, name=t.name, from_status_id=t.from_status_id, to_status_id=t.to_status_id
            )
            for t in view["transitions"]  # type: ignore[attr-defined]
        ],
        columns=[ColumnResponse(**c) for c in view["columns"]],  # type: ignore[attr-defined]
    )


@router.get("/{project_key}/members", response_model=ProjectMemberListResponse)
async def list_members(access: ViewProject, services: Services) -> ProjectMemberListResponse:
    rows = await service.list_members(services, access)
    return ProjectMemberListResponse(
        items=[
            ProjectMemberResponse(
                user_id=m.user_id, display_name=m.display_name, email=m.email, role=m.role
            )
            for m in rows
        ]
    )


@router.post(
    "/{project_key}/members", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfProtected]
)
async def add_member(
    body: AddProjectMemberRequest,
    request: Request,
    access: ManageProjectMembers,
    services: Services,
) -> Response:
    await service.add_member(
        services, access, user_id=body.user_id, role=body.role, client=client_info(request)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/{project_key}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def update_member(
    user_id: uuid.UUID,
    body: UpdateProjectMemberRequest,
    request: Request,
    access: ManageProjectMembers,
    services: Services,
) -> Response:
    await service.change_member(
        services, access, user_id=user_id, role=body.role, remove=False, client=client_info(request)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/{project_key}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def remove_member(
    user_id: uuid.UUID,
    request: Request,
    access: ManageProjectMembers,
    services: Services,
) -> Response:
    await service.change_member(
        services, access, user_id=user_id, role=None, remove=True, client=client_info(request)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
