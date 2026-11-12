"""Organization catalog management: issue types and priorities (Phase A)."""

import uuid

from sqlalchemy.exc import IntegrityError

from app.authz.deps import OrgAccess, not_found, org_transaction
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.orgs import repository
from app.modules.orgs.catalog_schemas import (
    CreateIssueTypeRequest,
    CreatePriorityRequest,
    ReorderIssueTypesRequest,
    ReorderPrioritiesRequest,
    UpdateIssueTypeRequest,
    UpdatePriorityRequest,
)
from app.modules.orgs.models import IssueType, Priority
from app.modules.orgs.schemas import IssueTypeResponse, PriorityResponse
from app.modules.security_events.service import ClientInfo


def _name_taken(entity: str) -> AppError:
    return AppError(
        409,
        f"{entity}_name_taken",
        f"A {entity.replace('_', ' ')} with this name already exists.",
        errors=[{"field": "body.name", "message": "is already in use"}],
    )


def _issue_type_response(row: IssueType) -> IssueTypeResponse:
    return IssueTypeResponse(
        id=row.id, name=row.name, kind=row.kind, position=row.position, is_active=row.is_active
    )


def _priority_response(row: Priority) -> PriorityResponse:
    return PriorityResponse(
        id=row.id,
        name=row.name,
        sort_order=row.sort_order,
        color=row.color,
        is_active=row.is_active,
    )


async def create_issue_type(
    services: IdentityServices,
    access: OrgAccess,
    body: CreateIssueTypeRequest,
    *,
    client: ClientInfo,
) -> IssueTypeResponse:
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        position = await repository.next_issue_type_position(session)
        try:
            row = await repository.insert_issue_type(
                session, name=body.name, kind=body.kind, position=position
            )
        except IntegrityError as exc:
            if "uq_issue_types_org_id_name" in str(exc.orig):
                raise _name_taken("issue_type") from None
            raise
        await audit.record(
            session,
            "org.issue_type.created",
            client,
            actor_user_id=current.user_id,
            target_type="issue_type",
            target_id=str(row.id),
            metadata={"name": row.name, "kind": row.kind},
        )
        return _issue_type_response(row)


async def update_issue_type(
    services: IdentityServices,
    access: OrgAccess,
    type_id: uuid.UUID,
    body: UpdateIssueTypeRequest,
    *,
    client: ClientInfo,
) -> IssueTypeResponse:
    fields_set = body.model_fields_set
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        existing = await repository.get_issue_type(session, type_id)
        if existing is None:
            raise not_found()
        changes: dict[str, object] = {}
        changed_fields: list[str] = []
        if "name" in fields_set and body.name != existing.name:
            changes["name"] = body.name
            changed_fields.append("name")
        if "is_active" in fields_set and body.is_active != existing.is_active:
            changes["is_active"] = body.is_active
            changed_fields.append("is_active")
        if not changes:
            return _issue_type_response(existing)
        try:
            updated = await repository.update_issue_type(session, type_id, **changes)
        except IntegrityError as exc:
            if "uq_issue_types_org_id_name" in str(exc.orig):
                raise _name_taken("issue_type") from None
            raise
        if updated is None:
            raise not_found()
        await audit.record(
            session,
            "org.issue_type.updated",
            client,
            actor_user_id=current.user_id,
            target_type="issue_type",
            target_id=str(type_id),
            metadata={"fields": ",".join(changed_fields)},
        )
        return _issue_type_response(updated)


async def reorder_issue_types(
    services: IdentityServices,
    access: OrgAccess,
    body: ReorderIssueTypesRequest,
    *,
    client: ClientInfo,
) -> list[IssueTypeResponse]:
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        existing = await repository.list_issue_types(session)
        known = [t.id for t in existing]
        if len(set(body.ids)) != len(body.ids) or not set(body.ids) <= set(known):
            raise AppError(
                422, "invalid_order", "List each issue type of this organization at most once."
            )
        rest = [t_id for t_id in known if t_id not in set(body.ids)]
        await repository.set_issue_type_positions(session, [*body.ids, *rest])
        await audit.record(
            session,
            "org.issue_type.reordered",
            client,
            actor_user_id=current.user_id,
            target_type="organization",
            target_id=str(current.org_id),
        )
        rows = await repository.list_issue_types(session)
        return [_issue_type_response(t) for t in rows]


async def create_priority(
    services: IdentityServices,
    access: OrgAccess,
    body: CreatePriorityRequest,
    *,
    client: ClientInfo,
) -> PriorityResponse:
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        sort_order = await repository.next_priority_sort_order(session)
        try:
            row = await repository.insert_priority(
                session, name=body.name, sort_order=sort_order, color=body.color
            )
        except IntegrityError as exc:
            if "uq_priorities_org_id_name" in str(exc.orig):
                raise _name_taken("priority") from None
            raise
        await audit.record(
            session,
            "org.priority.created",
            client,
            actor_user_id=current.user_id,
            target_type="priority",
            target_id=str(row.id),
            metadata={"name": row.name},
        )
        return _priority_response(row)


async def update_priority(
    services: IdentityServices,
    access: OrgAccess,
    priority_id: uuid.UUID,
    body: UpdatePriorityRequest,
    *,
    client: ClientInfo,
) -> PriorityResponse:
    fields_set = body.model_fields_set
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        existing = await repository.get_priority(session, priority_id)
        if existing is None:
            raise not_found()
        changes: dict[str, object] = {}
        changed_fields: list[str] = []
        if "name" in fields_set and body.name != existing.name:
            changes["name"] = body.name
            changed_fields.append("name")
        if "color" in fields_set and body.color != existing.color:
            changes["color"] = body.color
            changed_fields.append("color")
        if "is_active" in fields_set and body.is_active != existing.is_active:
            changes["is_active"] = body.is_active
            changed_fields.append("is_active")
        if not changes:
            return _priority_response(existing)
        try:
            updated = await repository.update_priority(session, priority_id, **changes)
        except IntegrityError as exc:
            if "uq_priorities_org_id_name" in str(exc.orig):
                raise _name_taken("priority") from None
            raise
        if updated is None:
            raise not_found()
        await audit.record(
            session,
            "org.priority.updated",
            client,
            actor_user_id=current.user_id,
            target_type="priority",
            target_id=str(priority_id),
            metadata={"fields": ",".join(changed_fields)},
        )
        return _priority_response(updated)


async def reorder_priorities(
    services: IdentityServices,
    access: OrgAccess,
    body: ReorderPrioritiesRequest,
    *,
    client: ClientInfo,
) -> list[PriorityResponse]:
    async with org_transaction(services, access, Permission.ORG_MANAGE) as (session, current):
        existing = await repository.list_priorities(session)
        known = [p.id for p in existing]
        if len(set(body.ids)) != len(body.ids) or not set(body.ids) <= set(known):
            raise AppError(
                422, "invalid_order", "List each priority of this organization at most once."
            )
        rest = [p_id for p_id in known if p_id not in set(body.ids)]
        await repository.set_priority_sort_orders(session, [*body.ids, *rest])
        await audit.record(
            session,
            "org.priority.reordered",
            client,
            actor_user_id=current.user_id,
            target_type="organization",
            target_id=str(current.org_id),
        )
        rows = await repository.list_priorities(session)
        return [_priority_response(p) for p in rows]
