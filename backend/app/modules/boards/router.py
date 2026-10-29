"""Board HTTP API (M9). Moving cards is ``POST /issues/{key}/move`` in the issues router."""

from typing import Annotated

from fastapi import APIRouter, Request

from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, require_project
from app.modules.boards import service
from app.modules.boards.schemas import BoardResponse, ReplaceColumnsRequest
from app.modules.identity.deps import CsrfProtected, Services, client_info

router = APIRouter(prefix="/api/v1/orgs/{org_slug}/projects/{project_key}/board", tags=["boards"])

ViewBoard = Annotated[ProjectAccess, require_project(Permission.PROJECT_VIEW)]
ManageBoard = Annotated[ProjectAccess, require_project(Permission.BOARD_MANAGE)]


@router.get("", response_model=BoardResponse)
async def get_board(access: ViewBoard, services: Services) -> BoardResponse:
    return await service.get_board(services, access)


@router.put("/columns", response_model=BoardResponse, dependencies=[CsrfProtected])
async def replace_columns(
    body: ReplaceColumnsRequest, access: ManageBoard, services: Services, request: Request
) -> BoardResponse:
    return await service.replace_columns(services, access, body, client_info(request))
