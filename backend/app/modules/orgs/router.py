"""Organization HTTP API (M3). All routes are under /api/v1.

Org-scoped routes declare their permission with ``require(...)`` and resolve the org
through the caller's active membership; every inaccessible org yields the same 404.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from app.authz.deps import OrgAccess, require
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.modules.identity.deps import CsrfProtected, CurrentSession, Services, client_info
from app.modules.orgs import service
from app.modules.orgs.repository import AuditFilter, OrgRecord
from app.modules.orgs.schemas import (
    AuditEventListResponse,
    AuditEventResponse,
    CreateOrgRequest,
    IssueTypeListResponse,
    IssueTypeResponse,
    OrgListResponse,
    OrgResponse,
    OrgSummary,
    PriorityListResponse,
    PriorityResponse,
    UpdateOrgRequest,
)

router = APIRouter(prefix="/api/v1", tags=["orgs"])

ViewOrg = Annotated[OrgAccess, require(Permission.ORG_VIEW)]
ManageOrg = Annotated[OrgAccess, require(Permission.ORG_MANAGE)]
ViewAudit = Annotated[OrgAccess, require(Permission.ORG_AUDIT_VIEW)]


def _org_response(org: OrgRecord, access: OrgAccess) -> OrgResponse:
    return OrgResponse(
        id=org.id,
        slug=org.slug,
        name=org.name,
        role=access.role,
        permissions=sorted(p.value for p in access.permissions),
        created_at=org.created_at,
    )


@router.post(
    "/orgs",
    status_code=status.HTTP_201_CREATED,
    response_model=OrgSummary,
    dependencies=[CsrfProtected],
)
async def create_org(
    body: CreateOrgRequest,
    request: Request,
    response: Response,
    auth: CurrentSession,
    services: Services,
) -> OrgSummary:
    """Requires a verified email. The caller becomes the organization's owner."""
    created = await service.create_org(
        services, auth, slug=body.slug, name=body.name, client=client_info(request)
    )
    response.headers["Location"] = f"/api/v1/orgs/{created.slug}"
    return OrgSummary(slug=created.slug, name=created.name, role="owner")


@router.get("/orgs", response_model=OrgListResponse)
async def list_my_orgs(auth: CurrentSession, services: Services) -> OrgListResponse:
    orgs = await service.list_my_orgs(services, auth.user_id)
    return OrgListResponse(items=[OrgSummary(slug=o.slug, name=o.name, role=o.role) for o in orgs])


@router.get("/orgs/{org_slug}", response_model=OrgResponse)
async def get_org(access: ViewOrg, services: Services) -> OrgResponse:
    org, current = await service.get_org(services, access)
    return _org_response(org, current)


@router.patch("/orgs/{org_slug}", response_model=OrgResponse, dependencies=[CsrfProtected])
async def update_org(
    body: UpdateOrgRequest, request: Request, access: ManageOrg, services: Services
) -> OrgResponse:
    """Renames the organization (display name only). The slug can never change."""
    if body.slug is not None:
        raise AppError(
            422,
            "field_immutable",
            "The organization address cannot be changed.",
            errors=[{"field": "body.slug", "message": "cannot be changed"}],
        )
    if body.name is None:
        org, current = await service.get_org(services, access)
    else:
        org, current = await service.rename_org(
            services, access, name=body.name, client=client_info(request)
        )
    return _org_response(org, current)


@router.get("/orgs/{org_slug}/issue-types", response_model=IssueTypeListResponse)
async def list_issue_types(access: ViewOrg, services: Services) -> IssueTypeListResponse:
    types = await service.list_issue_types(services, access)
    return IssueTypeListResponse(
        items=[
            IssueTypeResponse(id=t.id, name=t.name, kind=t.kind, position=t.position) for t in types
        ]
    )


@router.get("/orgs/{org_slug}/priorities", response_model=PriorityListResponse)
async def list_priorities(access: ViewOrg, services: Services) -> PriorityListResponse:
    priorities = await service.list_priorities(services, access)
    return PriorityListResponse(
        items=[
            PriorityResponse(id=p.id, name=p.name, sort_order=p.sort_order, color=p.color)
            for p in priorities
        ]
    )


@router.get("/orgs/{org_slug}/audit-events", response_model=AuditEventListResponse)
async def list_audit_events(
    access: ViewAudit,
    services: Services,
    *,
    action: Annotated[str | None, Query(max_length=64)] = None,
    actor: uuid.UUID | None = None,
    created_from: Annotated[datetime | None, Query(alias="from")] = None,
    created_to: Annotated[datetime | None, Query(alias="to")] = None,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> AuditEventListResponse:
    """Owners and admins only (members: 403). Newest first, cursor-paginated."""
    events, next_cursor = await service.list_audit_events(
        services,
        access,
        AuditFilter(
            action=action,
            actor_user_id=actor,
            created_from=created_from,
            created_to=created_to,
        ),
        limit=limit,
        cursor=cursor,
    )
    return AuditEventListResponse(
        items=[
            AuditEventResponse(
                id=e.id,
                action=e.action,
                actor_user_id=e.actor_user_id,
                target_type=e.target_type,
                target_id=e.target_id,
                outcome=e.outcome,
                ip=str(e.ip) if e.ip is not None else None,
                user_agent=e.user_agent,
                request_id=e.request_id,
                metadata=e.event_metadata,
                created_at=e.created_at,
            )
            for e in events
        ],
        next_cursor=next_cursor,
    )
