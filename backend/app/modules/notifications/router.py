"""Notification HTTP API (M11): own notifications only, for any active org member."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.authz.deps import OrgAccess, require
from app.authz.permissions import Permission
from app.modules.identity.deps import CsrfProtected, Services
from app.modules.notifications import service
from app.modules.notifications.schemas import (
    NotificationListResponse,
    ReadAllResponse,
    UnreadCountResponse,
)

router = APIRouter(prefix="/api/v1/orgs/{org_slug}/notifications", tags=["notifications"])

ViewOrg = Annotated[OrgAccess, require(Permission.ORG_VIEW)]


@router.get("", response_model=NotificationListResponse)
async def list_notifications(
    org: ViewOrg,
    services: Services,
    unread: bool = False,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> NotificationListResponse:
    return await service.list_notifications(
        services, org, unread_only=unread, cursor=cursor, limit=limit
    )


@router.get("/unread-count", response_model=UnreadCountResponse)
async def unread_count(org: ViewOrg, services: Services) -> UnreadCountResponse:
    return await service.unread_count(services, org)


@router.post("/read-all", response_model=ReadAllResponse, dependencies=[CsrfProtected])
async def read_all(org: ViewOrg, services: Services) -> ReadAllResponse:
    return await service.mark_all_read(services, org)


@router.post(
    "/{notification_id}/read",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def read_one(notification_id: uuid.UUID, org: ViewOrg, services: Services) -> Response:
    await service.mark_read(services, org, notification_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
