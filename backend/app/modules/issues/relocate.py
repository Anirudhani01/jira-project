"""Move an issue to another project of the same organization.

One issue at a time. The issue gets the next number of the target project (its old ``KEY-n``
stays resolvable through ``issue_key_aliases``), a status in the target workflow, and loses
what is project-scoped: sprint, fix version, parent. Labels are carried over by name
(created in the target project when missing). The caller needs ``issue.edit`` on the source
project and ``issue.create`` on the target; the database re-checks write access to both.
"""

import uuid
from datetime import UTC, datetime
from typing import Any

from app.authz.deps import forbidden, not_found
from app.authz.issues import IssueRef
from app.authz.permissions import Permission, project_permissions
from app.authz.projects import project_transaction
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.issues import repository
from app.modules.issues.schemas import IssueResponse, RelocateIssueRequest
from app.modules.issues.service import (
    _issue_response,
    _load,
    _writable,
    invalid_field,
    version_conflict,
)
from app.modules.projects import repository as projects_repository
from app.modules.security_events.service import ClientInfo


def map_status(
    source: Any, targets: list[Any], initial_status_id: uuid.UUID, requested: uuid.UUID | None
) -> uuid.UUID:
    """Status in the target workflow: the requested one, else same name, else the first status
    of the same category, else the target's initial status."""
    if requested is not None:
        if requested not in {status.id for status in targets}:
            raise invalid_field(
                "target_status_id", "invalid_status", "Unknown status in the target project."
            )
        return requested
    if source is not None:
        for status in targets:
            if str(status.name).casefold() == str(source.name).casefold():
                return uuid.UUID(str(status.id))
        same_category = sorted(
            (status for status in targets if status.category == source.category),
            key=lambda status: status.position,
        )
        if same_category:
            return uuid.UUID(str(same_category[0].id))
    return initial_status_id


async def relocate_issue(
    services: IdentityServices,
    ref: IssueRef,
    body: RelocateIssueRequest,
    expected_version: int,
    client: ClientInfo,
) -> IssueResponse:
    async with project_transaction(services, ref.project, Permission.ISSUE_EDIT) as (
        session,
        project,
        current,
    ):
        _writable(project)
        issue = await _load(session, project, ref)
        if issue.version != expected_version:
            raise version_conflict()
        issue_type = await repository.find_type(session, issue.type_id)
        if issue_type is not None and issue_type.kind == "subtask":
            raise AppError(
                422, "subtask_not_movable", "A sub-task cannot be moved to another project."
            )
        if await repository.count_active_children(session, project.id, issue.id):
            raise AppError(
                422,
                "has_children",
                "Move or remove this issue's children first; issues with children cannot be moved.",
            )

        target = await projects_repository.find_project(session, body.target_project_key)
        if target is None:
            raise not_found()
        target_role = await projects_repository.my_project_role(session, target.id)
        if current.org.role not in ("owner", "admin") and target_role is None:
            raise not_found()  # an invisible project looks like an unknown one
        if target.id == project.id:
            raise AppError(422, "same_project", "The issue is already in this project.")
        if Permission.ISSUE_CREATE not in project_permissions(current.org.role, target_role):
            raise forbidden()
        _writable(target)

        source_statuses = {
            status.id: status
            for status in await repository.workflow_statuses(session, project.workflow_id)
        }
        target_statuses = await repository.workflow_statuses(session, target.workflow_id)
        target_status_id = map_status(
            source_statuses.get(issue.status_id),
            target_statuses,
            await repository.initial_status(session, target.workflow_id),
            body.target_status_id,
        )
        target_category = next(s.category for s in target_statuses if s.id == target_status_id)

        # Project-scoped rows that reference the issue through (org, project, id) FKs.
        await repository.detach_deleted_children(session, project.id, issue.id)
        labels = await repository.list_issue_labels(session, issue.id)
        await repository.remove_issue_labels(session, issue.id)
        target_label_ids: set[uuid.UUID] = set()
        for label in labels:
            existing = await repository.find_label_by_name(session, target.id, label.name)
            if existing is not None:
                target_label_ids.add(existing.id)
                continue
            label_id = uuid.uuid4()
            await repository.create_label(session, label_id, target.id, label.name, label.color)
            target_label_ids.add(label_id)

        # Plain values: the session is expired after the DB function, so ORM objects must not
        # be read afterwards.
        issue_id, old_seq, old_done_at = issue.id, issue.seq, issue.done_at
        source_key, target_id, target_key = project.key, target.id, target.key
        target_workflow_id = target.workflow_id
        old_key = f"{source_key}-{old_seq}"
        new_seq = await repository.allocate_seq(session, target_id)  # last: holds the row lock
        done_at = (old_done_at or datetime.now(UTC)) if target_category == "done" else None
        updated = await repository.relocate_issue_row(
            session,
            issue_id,
            expected_version,
            project_id=target_id,
            workflow_id=target_workflow_id,
            seq=new_seq,
            status_id=target_status_id,
            rank=repository.initial_rank(new_seq),
            done_at=done_at,
        )
        if updated is None:
            raise version_conflict()
        await repository.set_issue_labels(
            session, target_id, issue_id, add=target_label_ids, remove=set()
        )
        await repository.insert_issue_key_alias(session, source_key, old_seq, issue_id)

        new_key = f"{target_key}-{new_seq}"
        await repository.add_activity(
            session,
            [
                {
                    "issue_id": issue_id,
                    "action": "moved_project",
                    "field": "project",
                    "old_value": {"key": old_key},
                    "new_value": {"key": new_key},
                }
            ],
        )
        await audit.record(
            session,
            "issue.moved_project",
            client,
            actor_user_id=current.org.user_id,
            target_type="issue",
            target_id=str(issue_id),
            metadata={"from": old_key, "to": new_key},
        )
        return await _issue_response(session, issue_id)
