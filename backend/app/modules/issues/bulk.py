"""Bulk change (research: docs/ui-redesign/jira-reference-research.md §6.3).

Every key goes through the same, fully validated single-issue service path in its own
transaction, so permissions, workflow/hierarchy rules, versioning, activity and notifications
behave exactly as for one edit. A failure on one issue never blocks the others; the response
reports a result per key. One audit event records the call."""

import logging

from app.authz.deps import OrgAccess, org_transaction
from app.authz.issues import resolve_issue
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.issues import service
from app.modules.issues.schemas import (
    BulkIssueRequest,
    BulkIssueResponse,
    BulkItemResult,
    MoveIssueRequest,
    UpdateIssueRequest,
)
from app.modules.security_events.service import ClientInfo

logger = logging.getLogger("app.issues.bulk")


async def _apply(
    services: IdentityServices, org: OrgAccess, body: BulkIssueRequest, key: str, client: ClientInfo
) -> None:
    ref = await resolve_issue(key, org, services)
    if body.action == "delete":
        await service.delete_issue(services, ref, client)
        return
    version = (await service.get_issue(services, ref)).version
    if body.action == "move_sprint":
        await service.move_issue(services, ref, MoveIssueRequest(sprint_id=body.sprint_id), version)
        return
    changes = {
        "assign": {"assignee_id": body.assignee_id},
        "set_priority": {"priority_id": body.priority_id},
        "set_parent": {"parent_id": body.parent_id},
        "set_fix_version": {"fix_version_id": body.fix_version_id},
    }[body.action]
    await service.update_issue(services, ref, UpdateIssueRequest(**changes), version)


async def bulk_change(
    services: IdentityServices, org: OrgAccess, body: BulkIssueRequest, client: ClientInfo
) -> BulkIssueResponse:
    results: list[BulkItemResult] = []
    for key in body.keys:
        try:
            await _apply(services, org, body, key.upper(), client)
            results.append(BulkItemResult(key=key, ok=True))
        except AppError as error:
            # Application errors carry user-safe messages; unknown keys and keys of projects
            # the caller cannot see are indistinguishable (same 404), as for a single request.
            results.append(
                BulkItemResult(
                    key=key, ok=False, code=error.code, message=error.detail or error.title
                )
            )
        except Exception:
            logger.exception("bulk item failed", extra={"event": "issues.bulk_item_failed"})
            results.append(
                BulkItemResult(
                    key=key, ok=False, code="internal_error", message="Could not apply the change."
                )
            )
    succeeded = sum(1 for result in results if result.ok)
    async with org_transaction(services, org, Permission.ORG_VIEW) as (session, current):
        await audit.record(
            session,
            "issue.bulk",
            client,
            actor_user_id=current.user_id,
            target_type="issues",
            metadata={
                "action": body.action,
                "requested": len(body.keys),
                "succeeded": succeeded,
            },
        )
    return BulkIssueResponse(results=results, succeeded=succeeded, failed=len(results) - succeeded)
