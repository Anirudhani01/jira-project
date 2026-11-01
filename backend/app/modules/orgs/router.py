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
from app.modules.identity.schemas import AcceptedResponse
from app.modules.org_auth_activity import service as org_auth_activity
from app.modules.org_auth_activity.schemas import (
    AuthenticationActivityItem,
    AuthenticationActivityListResponse,
)
from app.modules.org_auth_activity.service import AuthActivityFilter
from app.modules.orgs import members, service
from app.modules.orgs.repository import AuditFilter, OrgRecord
from app.modules.orgs.schemas import (
    AcceptInvitationRequest,
    AuditEventListResponse,
    AuditEventResponse,
    CreateInvitationRequest,
    CreateOrgRequest,
    InvitationListResponse,
    InvitationResponse,
    IssueTypeListResponse,
    IssueTypeResponse,
    JoinedOrgResponse,
    MemberListResponse,
    MemberResponse,
    OrgListResponse,
    OrgResponse,
    OrgSummary,
    PriorityListResponse,
    PriorityResponse,
    UpdateMemberRequest,
    UpdateOrgRequest,
)
from app.modules.orgs.settings_schemas import OrgSettingsResponse, UpdateOrgSettingsRequest

router = APIRouter(prefix="/api/v1", tags=["orgs"])

ViewOrg = Annotated[OrgAccess, require(Permission.ORG_VIEW)]
ManageOrg = Annotated[OrgAccess, require(Permission.ORG_MANAGE)]
ViewAudit = Annotated[OrgAccess, require(Permission.ORG_AUDIT_VIEW)]
ManageMembers = Annotated[OrgAccess, require(Permission.ORG_MEMBERS_MANAGE)]


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


@router.get("/orgs/{org_slug}/settings", response_model=OrgSettingsResponse)
async def get_org_settings(access: ViewOrg, services: Services) -> OrgSettingsResponse:
    record = await service.get_org_settings(services, access)
    return OrgSettingsResponse(
        timezone=record.timezone,
        locale=record.locale,
        story_points_enabled=record.story_points_enabled,
        story_points_max=record.story_points_max,
        updated_at=record.updated_at,
    )


@router.patch(
    "/orgs/{org_slug}/settings",
    response_model=OrgSettingsResponse,
    dependencies=[CsrfProtected],
)
async def update_org_settings(
    body: UpdateOrgSettingsRequest,
    request: Request,
    access: ManageOrg,
    services: Services,
) -> OrgSettingsResponse:
    record = await service.update_org_settings(services, access, body, client=client_info(request))
    return OrgSettingsResponse(
        timezone=record.timezone,
        locale=record.locale,
        story_points_enabled=record.story_points_enabled,
        story_points_max=record.story_points_max,
        updated_at=record.updated_at,
    )


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


@router.get(
    "/orgs/{org_slug}/authentication-activity",
    response_model=AuthenticationActivityListResponse,
)
async def list_authentication_activity(
    access: ViewAudit,
    services: Services,
    *,
    member: uuid.UUID | None = None,
    event_type: Annotated[str | None, Query(max_length=64)] = None,
    occurred_from: Annotated[datetime | None, Query(alias="from")] = None,
    occurred_to: Annotated[datetime | None, Query(alias="to")] = None,
    cursor: Annotated[str | None, Query(max_length=256)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> AuthenticationActivityListResponse:
    """Owners and admins only. Reads org authentication projections (not platform events)."""
    rows, next_cursor = await org_auth_activity.list_authentication_activity(
        services,
        access,
        AuthActivityFilter(
            member_user_id=member,
            event_type=event_type,
            occurred_from=occurred_from,
            occurred_to=occurred_to,
        ),
        limit=limit,
        cursor=cursor,
    )
    return AuthenticationActivityListResponse(
        items=[
            AuthenticationActivityItem(
                id=row.id,
                user_id=row.user_id,
                member_display_name=row.member_display_name,
                member_status=row.member_status,
                event_type=row.event_type,
                outcome=row.outcome,
                reason=row.reason,
                metadata=row.metadata,
                occurred_at=row.occurred_at,
            )
            for row in rows
        ],
        next_cursor=next_cursor,
    )


# ----------------------------------------------------------------------------- M4
@router.get("/orgs/{org_slug}/members", response_model=MemberListResponse)
async def list_members(access: ViewOrg, services: Services) -> MemberListResponse:
    rows = await members.list_members(services, access)
    return MemberListResponse(
        items=[
            MemberResponse(
                user_id=m.user_id,
                display_name=m.display_name,
                email=m.email,
                role=m.role,
                can_create_projects=m.can_create_projects,
                joined_at=m.created_at,
            )
            for m in rows
        ]
    )


@router.patch(
    "/orgs/{org_slug}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def update_member(
    user_id: uuid.UUID,
    body: UpdateMemberRequest,
    request: Request,
    access: ManageMembers,
    services: Services,
) -> Response:
    """Change a member's role and/or the explicit project-creation grant (D9).
    Only owners manage owners; the last owner cannot be demoted (409 last_owner)."""
    await members.change_member(
        services,
        access,
        user_id,
        members.MemberChange(role=body.role, can_create_projects=body.can_create_projects),
        client_info(request),
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete(
    "/orgs/{org_slug}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def remove_member(
    user_id: uuid.UUID, request: Request, access: ManageMembers, services: Services
) -> Response:
    await members.remove_member(services, access, user_id, client_info(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/orgs/{org_slug}/invitations", response_model=InvitationListResponse)
async def list_invitations(access: ManageMembers, services: Services) -> InvitationListResponse:
    rows = await members.list_invitations(services, access)
    return InvitationListResponse(
        items=[
            InvitationResponse(
                id=r.id,
                email=r.email,
                role=r.role,
                created_at=r.created_at,
                expires_at=r.expires_at,
                expired=r.expired,
            )
            for r in rows
        ]
    )


@router.post(
    "/orgs/{org_slug}/invitations",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AcceptedResponse,
    dependencies=[CsrfProtected],
)
async def create_invitation(
    body: CreateInvitationRequest, request: Request, access: ManageMembers, services: Services
) -> AcceptedResponse:
    """Queues the invitation email (the worker mints the token). 100 per org per day."""
    await members.create_invitation(
        services, access, email=body.email, role=body.role, client=client_info(request)
    )
    return AcceptedResponse()


@router.delete(
    "/orgs/{org_slug}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[CsrfProtected],
)
async def revoke_invitation(
    invitation_id: uuid.UUID, request: Request, access: ManageMembers, services: Services
) -> Response:
    await members.revoke_invitation(services, access, invitation_id, client_info(request))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/invitations/accept", response_model=JoinedOrgResponse, dependencies=[CsrfProtected])
async def accept_invitation(
    body: AcceptInvitationRequest, request: Request, auth: CurrentSession, services: Services
) -> JoinedOrgResponse:
    """Requires signing in with the invited, verified email address (D1)."""
    joined = await members.accept_invitation(
        services, auth, token=body.token, client=client_info(request)
    )
    return JoinedOrgResponse(slug=joined.slug, name=joined.name, role=joined.role)
