"""Version HTTP API: create/edit/reorder/delete, release/unrelease and archive/unarchive."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, require_project
from app.authz.versions import VersionRef, require_version
from app.modules.identity.deps import CsrfProtected, Services, client_info
from app.modules.versions import service
from app.modules.versions.schemas import (
    CreateVersionRequest,
    ReleaseVersionRequest,
    ReleaseVersionResponse,
    ReorderVersionsRequest,
    UpdateVersionRequest,
    VersionListResponse,
    VersionResponse,
)

router = APIRouter(prefix="/api/v1/orgs/{org_slug}", tags=["versions"])

ViewProject = Annotated[ProjectAccess, require_project(Permission.PROJECT_VIEW)]
ManageVersions = Annotated[ProjectAccess, require_project(Permission.VERSION_MANAGE)]
ManageVersion = Annotated[VersionRef, require_version(Permission.VERSION_MANAGE)]


@router.get("/projects/{project_key}/versions", response_model=VersionListResponse)
async def list_versions(
    access: ViewProject, services: Services, include_archived: bool = False
) -> VersionListResponse:
    return await service.list_versions(services, access, include_archived=include_archived)


@router.post(
    "/projects/{project_key}/versions",
    response_model=VersionResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CsrfProtected],
)
async def create_version(
    body: CreateVersionRequest, access: ManageVersions, services: Services
) -> VersionResponse:
    return await service.create_version(services, access, body)


@router.put(
    "/projects/{project_key}/versions/order",
    response_model=VersionListResponse,
    dependencies=[CsrfProtected],
)
async def reorder_versions(
    body: ReorderVersionsRequest, access: ManageVersions, services: Services
) -> VersionListResponse:
    return await service.reorder_versions(services, access, body)


@router.patch(
    "/versions/{version_id}", response_model=VersionResponse, dependencies=[CsrfProtected]
)
async def update_version(
    body: UpdateVersionRequest, ref: ManageVersion, services: Services
) -> VersionResponse:
    return await service.update_version(services, ref, body)


@router.delete(
    "/versions/{version_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def delete_version(
    ref: ManageVersion,
    services: Services,
    request: Request,
    move_to: Annotated[uuid.UUID | None, Query()] = None,
) -> Response:
    """Deletes the version; its issues move to ``move_to`` or lose their fix version."""
    await service.delete_version(services, ref, move_to, client_info(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/versions/{version_id}/release",
    response_model=ReleaseVersionResponse,
    dependencies=[CsrfProtected],
)
async def release_version(
    body: ReleaseVersionRequest, ref: ManageVersion, services: Services, request: Request
) -> ReleaseVersionResponse:
    return await service.release_version(services, ref, body, client_info(request))


@router.post(
    "/versions/{version_id}/unrelease", response_model=VersionResponse, dependencies=[CsrfProtected]
)
async def unrelease_version(ref: ManageVersion, services: Services) -> VersionResponse:
    return await service.unrelease_version(services, ref)


@router.post(
    "/versions/{version_id}/archive", response_model=VersionResponse, dependencies=[CsrfProtected]
)
async def archive_version(
    ref: ManageVersion, services: Services, request: Request
) -> VersionResponse:
    return await service.archive_version(services, ref, client_info(request))


@router.post(
    "/versions/{version_id}/unarchive", response_model=VersionResponse, dependencies=[CsrfProtected]
)
async def unarchive_version(ref: ManageVersion, services: Services) -> VersionResponse:
    return await service.unarchive_version(services, ref)
