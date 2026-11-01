"""Recording org audit events (plan §4.4, V2.7, D5).

Written in the caller's transaction and fail-closed: if the audit insert fails, the
audited action fails with it. Metadata is allowlisted per action; an unexpected key is a
programming error and raises, so secrets cannot slip in through ad-hoc metadata. Request
bodies, tokens, passwords and cookies are never recorded.
"""

import uuid
from typing import Final, Literal, cast

from sqlalchemy import Table, insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import request_id_var
from app.db.tenant import require_org_context
from app.modules.audit.models import AuditEvent
from app.modules.security_events.service import ClientInfo

AUDIT_TABLE = cast(Table, AuditEvent.__table__)
MetadataValue = str | int | bool
Outcome = Literal["success", "failure"]

ACTION_METADATA_ALLOWLIST: Final[dict[str, frozenset[str]]] = {
    "org.created": frozenset({"slug"}),
    "org.updated": frozenset({"fields"}),
    "org.settings.updated": frozenset({"fields"}),
    # M4
    "org.member.invited": frozenset({"role"}),
    "org.invitation.revoked": frozenset(),
    "org.member.joined": frozenset({"role"}),
    "org.member.role_changed": frozenset({"old_role", "new_role"}),
    "org.member.removed": frozenset({"role"}),
    "org.member.permission_changed": frozenset({"permission", "granted"}),
    # M5
    "project.created": frozenset({"key"}),
    "project.updated": frozenset({"fields"}),
    "project.settings.updated": frozenset({"project", "fields"}),
    "project.archived": frozenset(),
    "project.unarchived": frozenset(),
    "project.member.added": frozenset({"project", "role"}),
    "project.member.role_changed": frozenset({"project", "old_role", "new_role"}),
    "project.member.removed": frozenset({"project", "role"}),
    "issue.bulk": frozenset({"action", "requested", "succeeded"}),
    "version.released": frozenset({"project", "name", "moved"}),
    "version.archived": frozenset({"project", "name"}),
    "version.deleted": frozenset({"project", "name"}),
    "sprint.started": frozenset({"project", "name"}),
    "sprint.completed": frozenset({"project", "name", "moved"}),
    "board.columns.updated": frozenset({"project", "columns"}),
    "issue.deleted": frozenset({"key"}),
    "workflow.metadata.updated": frozenset({"project", "fields"}),
    "workflow.initial_status.changed": frozenset({"project", "from_status_id", "to_status_id"}),
    "workflow.status.created": frozenset({"project", "status_id", "name"}),
    "workflow.status.updated": frozenset({"project", "status_id", "fields"}),
    "workflow.status.deleted": frozenset(
        {"project", "status_id", "replacement_status_id", "issues_remapped"}
    ),
    "workflow.transition.created": frozenset({"project", "transition_id", "name"}),
    "workflow.transition.deleted": frozenset({"project", "transition_id"}),
    "workflow.board_mapping.updated": frozenset({"project", "columns"}),
}


def _validate(action: str, metadata: dict[str, MetadataValue]) -> None:
    allowed = ACTION_METADATA_ALLOWLIST.get(action)
    if allowed is None:
        raise ValueError(f"unknown audit action: {action}")
    unexpected = set(metadata) - allowed
    if unexpected:
        raise ValueError(f"metadata keys not allowlisted for {action}: {sorted(unexpected)}")


async def record(
    session: AsyncSession,
    action: str,
    client: ClientInfo,
    *,
    actor_user_id: uuid.UUID | None,
    target_type: str | None = None,
    target_id: str | None = None,
    outcome: Outcome = "success",
    metadata: dict[str, MetadataValue] | None = None,
) -> None:
    """Insert in the caller's transaction for its bound org (RLS also enforces both)."""
    context = require_org_context(session)
    metadata = metadata or {}
    _validate(action, metadata)
    await session.execute(
        insert(AUDIT_TABLE)
        .inline()
        .values(
            org_id=context.org_id,
            actor_user_id=actor_user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            outcome=outcome,
            ip=client.ip,
            user_agent=client.user_agent[:256] if client.user_agent else None,
            request_id=request_id_var.get(),
            metadata=metadata,
        )
    )
