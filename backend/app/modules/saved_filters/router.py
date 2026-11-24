"""Saved-filter HTTP API: a user's own named issue-list filters for one project."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Response, status

from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, require_project
from app.modules.identity.deps import CsrfProtected, Services
from app.modules.saved_filters import service
from app.modules.saved_filters.schemas import (
    CreateSavedFilterRequest,
    SavedFilterListResponse,
    SavedFilterResponse,
    UpdateSavedFilterRequest,
)

router = APIRouter(
    prefix="/api/v1/orgs/{org_slug}/projects/{project_key}/saved-filters", tags=["saved-filters"]
)

ViewProject = Annotated[ProjectAccess, require_project(Permission.PROJECT_VIEW)]


@router.get("", response_model=SavedFilterListResponse)
async def list_saved_filters(access: ViewProject, services: Services) -> SavedFilterListResponse:
    return await service.list_filters(services, access)


@router.post(
    "",
    response_model=SavedFilterResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[CsrfProtected],
)
async def create_saved_filter(
    body: CreateSavedFilterRequest, access: ViewProject, services: Services
) -> SavedFilterResponse:
    return await service.create_filter(services, access, body)


@router.patch("/{filter_id}", response_model=SavedFilterResponse, dependencies=[CsrfProtected])
async def update_saved_filter(
    filter_id: uuid.UUID,
    body: UpdateSavedFilterRequest,
    access: ViewProject,
    services: Services,
) -> SavedFilterResponse:
    return await service.update_filter(services, access, filter_id, body)


@router.delete("/{filter_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[CsrfProtected])
async def delete_saved_filter(
    filter_id: uuid.UUID, access: ViewProject, services: Services
) -> Response:
    await service.delete_filter(services, access, filter_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
