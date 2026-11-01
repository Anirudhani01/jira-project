"""Project use cases (plan M5, D9 Option B, R4 creation atomicity).

- Creating a project requires ``project.create`` (org owner/admin or explicit grant); it
  writes the workflow clone, board, columns, counter, creator's project-admin membership
  and the ``project.created`` audit event in ONE transaction. Creating a project grants
  the creator nothing org-wide.
- The key is unique per org and immutable; archived projects are read-only except
  unarchive.
- Project members must be active org members.
"""

import uuid

from sqlalchemy.exc import IntegrityError

from app.authz.deps import OrgAccess, not_found, org_transaction
from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.core.errors import AppError
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.orgs import repository as orgs
from app.modules.projects import repository
from app.modules.projects.models import Project
from app.modules.projects.repository import NewProject, ProjectMemberRow
from app.modules.security_events.service import ClientInfo


def project_archived() -> AppError:
    return AppError(409, "project_archived", "Archived projects are read-only.")


async def create_project(
    services: IdentityServices,
    access: OrgAccess,
    *,
    key: str,
    name: str,
    description: str | None,
    board_type: str,
    client: ClientInfo,
) -> uuid.UUID:
    project_id = uuid.uuid4()
    try:
        async with org_transaction(services, access, Permission.PROJECT_CREATE) as (
            session,
            current,
        ):
            await repository.create_project(
                session,
                NewProject(
                    id=project_id,
                    key=key,
                    name=name,
                    description=description,
                    board_type=board_type,
                    creator_id=current.user_id,
                ),
            )
            await audit.record(
                session,
                "project.created",
                client,
                actor_user_id=current.user_id,
                target_type="project",
                target_id=str(project_id),
                metadata={"key": key},
            )
    except IntegrityError as exc:
        if "uq_projects_org_id_key" in str(exc.orig):
            raise AppError(
                409,
                "project_key_taken",
                "This project key is already used in the organization.",
                errors=[{"field": "body.key", "message": "is already used"}],
            ) from None
        raise
    return project_id


async def list_projects(
    services: IdentityServices, access: OrgAccess, *, archived: bool
) -> list[tuple[Project, str | None]]:
    async with org_transaction(services, access, Permission.ORG_VIEW) as (session, current):
        return await repository.list_projects(
            session, archived=archived, all_projects=current.role in ("owner", "admin")
        )


async def get_project(
    services: IdentityServices, access: ProjectAccess
) -> tuple[Project, ProjectAccess]:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        _,
        project,
        current,
    ):
        return project, current


async def update_project(
    services: IdentityServices,
    access: ProjectAccess,
    *,
    name: str | None,
    description: str | None,
    clear_description: bool,
    client: ClientInfo,
) -> None:
    async with project_transaction(services, access, Permission.PROJECT_MANAGE) as (
        session,
        project,
        current,
    ):
        if project.archived_at is not None:
            raise project_archived()
        values: dict[str, object] = {}
        if name is not None and name != project.name:
            values["name"] = name
        if clear_description or (description is not None and description != project.description):
            values["description"] = description
        if values:
            await repository.update_project(session, project.id, **values)
            await audit.record(
                session,
                "project.updated",
                client,
                actor_user_id=current.org.user_id,
                target_type="project",
                target_id=str(project.id),
                metadata={"fields": ",".join(sorted(values))},
            )


async def set_archived(
    services: IdentityServices, access: ProjectAccess, *, archived: bool, client: ClientInfo
) -> None:
    async with project_transaction(services, access, Permission.PROJECT_MANAGE) as (
        session,
        project,
        current,
    ):
        if (project.archived_at is not None) == archived:
            return
        await repository.update_project(
            session, project.id, archived_at=orgs.now() if archived else None
        )
        await audit.record(
            session,
            "project.archived" if archived else "project.unarchived",
            client,
            actor_user_id=current.org.user_id,
            target_type="project",
            target_id=str(project.id),
        )


async def workflow(services: IdentityServices, access: ProjectAccess) -> dict[str, object]:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        return await repository.workflow_view(session, project)


async def _record_workflow_audit(
    session,
    diff,
    *,
    client: ClientInfo,
    actor_id: uuid.UUID,
    project: Project,
    column_count: int | None = None,
) -> None:
    target = {"target_type": "project", "target_id": str(project.id)}
    meta_base = {"project": project.key}
    if diff.metadata_fields:
        await audit.record(
            session,
            "workflow.metadata.updated",
            client,
            actor_user_id=actor_id,
            metadata={**meta_base, "fields": ",".join(diff.metadata_fields)},
            **target,
        )
    if diff.initial_from is not None and diff.initial_to is not None:
        await audit.record(
            session,
            "workflow.initial_status.changed",
            client,
            actor_user_id=actor_id,
            metadata={
                **meta_base,
                "from_status_id": str(diff.initial_from),
                "to_status_id": str(diff.initial_to),
            },
            **target,
        )
    for status_id, name in diff.statuses_created:
        await audit.record(
            session,
            "workflow.status.created",
            client,
            actor_user_id=actor_id,
            metadata={**meta_base, "status_id": str(status_id), "name": name},
            **target,
        )
    for status_id, fields in diff.statuses_updated:
        await audit.record(
            session,
            "workflow.status.updated",
            client,
            actor_user_id=actor_id,
            metadata={**meta_base, "status_id": str(status_id), "fields": ",".join(fields)},
            **target,
        )
    for status_id, replacement, count in diff.statuses_deleted:
        await audit.record(
            session,
            "workflow.status.deleted",
            client,
            actor_user_id=actor_id,
            metadata={
                **meta_base,
                "status_id": str(status_id),
                "replacement_status_id": str(replacement) if replacement else "",
                "issues_remapped": count,
            },
            **target,
        )
    for transition_id, name in diff.transitions_created:
        await audit.record(
            session,
            "workflow.transition.created",
            client,
            actor_user_id=actor_id,
            metadata={**meta_base, "transition_id": str(transition_id), "name": name},
            **target,
        )
    for transition_id in diff.transitions_deleted:
        await audit.record(
            session,
            "workflow.transition.deleted",
            client,
            actor_user_id=actor_id,
            metadata={**meta_base, "transition_id": str(transition_id)},
            **target,
        )
    if diff.board_mapping_changed and column_count is not None:
        await audit.record(
            session,
            "workflow.board_mapping.updated",
            client,
            actor_user_id=actor_id,
            metadata={**meta_base, "columns": column_count},
            **target,
        )


async def replace_workflow(
    services: IdentityServices,
    access: ProjectAccess,
    body,
    *,
    expected_revision: int,
    client: ClientInfo,
) -> dict[str, object]:
    from app.modules.boards import repository as boards_repo
    from app.modules.boards.column_mapping import validate_column_mapping
    from app.modules.projects import workflow_edit
    from app.modules.projects.schemas import ReplaceWorkflowRequest
    from app.modules.projects.workflow_errors import (
        status_in_use,
        status_name_taken,
        workflow_revision_conflict,
    )

    assert isinstance(body, ReplaceWorkflowRequest)
    async with project_transaction(services, access, Permission.PROJECT_MANAGE) as (
        session,
        project,
        current,
    ):
        if project.archived_at is not None:
            raise project_archived()
        locked = await repository.lock_workflow_for_update(session, project.workflow_id)
        if locked.revision != expected_revision:
            raise workflow_revision_conflict()
        await repository.lock_project_for_update(session, project.id)
        view = await repository.workflow_view(session, project)
        current_graph = workflow_edit.graph_from_view(view, locked.revision)
        desired = workflow_edit.desired_graph(body)
        remaps = workflow_edit.remap_lookup(body)
        removing = workflow_edit.removed_status_ids(current_graph, desired)
        issue_counts = await repository.issue_counts_by_status(session, project.id, removing)
        workflow_edit.validate_remaps(removing, desired, issue_counts, remaps)

        def _column_canonical_from_view(columns: list[dict[str, object]]) -> list[dict[str, object]]:
            return sorted(
                [
                    {
                        "name": column["name"],
                        "position": column["position"],
                        "status_ids": sorted(str(s) for s in column["status_ids"]),
                    }
                    for column in columns
                ],
                key=lambda row: row["position"],
            )

        def _column_canonical_from_body(columns) -> list[dict[str, object]]:
            return sorted(
                [
                    {
                        "name": column.name,
                        "position": index,
                        "status_ids": sorted(str(s) for s in column.status_ids),
                    }
                    for index, column in enumerate(columns)
                ],
                key=lambda row: row["position"],
            )

        current_columns = _column_canonical_from_view(view["columns"])  # type: ignore[arg-type]
        desired_columns = _column_canonical_from_body(body.columns)
        columns_changed = current_columns != desired_columns
        if (
            workflow_edit.canonical_payload(current_graph, current_columns)
            == workflow_edit.canonical_payload(desired, desired_columns)
            and not columns_changed
        ):
            return view

        board = await boards_repo.find_board(session, project.id)
        column_tuples = await validate_column_mapping(
            session,
            project,
            board,
            body.columns,
            expected_status_ids=set(desired.statuses),
        )
        await repository.lock_issues_for_statuses(session, project.id, removing)
        categories = {spec.id: spec.category for spec in desired.statuses.values()}
        for status_id in removing:
            if issue_counts.get(status_id, 0):
                target = remaps[status_id]
                await repository.remap_issues_status(
                    session,
                    project.id,
                    status_id,
                    target,
                    mark_done=categories[target] == "done",
                )
        remaining = await repository.issue_counts_by_status(session, project.id, removing)
        if any(remaining.values()):
            raise status_in_use()
        audit_diff = workflow_edit.diff_graph(
            current_graph,
            desired,
            remaps=remaps,
            issue_counts=issue_counts,
            columns_changed=columns_changed,
        )
        audit_diff.board_mapping_changed = columns_changed
        try:
            await repository.prune_workflow_transitions(
                session, project.workflow_id, desired, removing=removing
            )
            await repository.upsert_workflow_statuses(
                session, project.workflow_id, desired, removing=removing
            )
            await boards_repo.replace_columns(session, board, column_tuples)
            await repository.delete_workflow_statuses(session, removing)
            await repository.finalize_workflow_graph(session, project.workflow_id, desired)
        except IntegrityError as error:
            from app.modules.projects.workflow_integrity import (
                conflicting_status_name,
                is_workflow_status_name_conflict,
            )

            if is_workflow_status_name_conflict(error):
                taken = conflicting_status_name(error, body.statuses[0].name)
                raise status_name_taken(taken) from error
            raise
        await _record_workflow_audit(
            session,
            audit_diff,
            client=client,
            actor_id=current.org.user_id,
            project=project,
            column_count=len(body.columns) if columns_changed else None,
        )
        return await repository.workflow_view(session, project)


# ------------------------------------------------------------------- project members
async def list_members(services: IdentityServices, access: ProjectAccess) -> list[ProjectMemberRow]:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        return await repository.list_project_members(session, project.id)


async def add_member(
    services: IdentityServices,
    access: ProjectAccess,
    *,
    user_id: uuid.UUID,
    role: str,
    client: ClientInfo,
) -> None:
    async with project_transaction(services, access, Permission.PROJECT_MEMBERS_MANAGE) as (
        session,
        project,
        current,
    ):
        if project.archived_at is not None:
            raise project_archived()
        org_member = await orgs.get_member(session, user_id)
        if org_member is None or org_member.removed_at is not None:
            raise AppError(
                422,
                "not_org_member",
                "Only members of the organization can join its projects.",
                errors=[
                    {"field": "body.user_id", "message": "is not a member of the organization"}
                ],
            )
        if await repository.get_project_member(session, project.id, user_id) is not None:
            raise AppError(409, "already_project_member", "This person is already a member.")
        await repository.add_project_member(session, project.id, user_id, role)
        await audit.record(
            session,
            "project.member.added",
            client,
            actor_user_id=current.org.user_id,
            target_type="user",
            target_id=str(user_id),
            metadata={"project": project.key, "role": role},
        )


async def change_member(
    services: IdentityServices,
    access: ProjectAccess,
    *,
    user_id: uuid.UUID,
    role: str | None,
    remove: bool,
    client: ClientInfo,
) -> None:
    async with project_transaction(services, access, Permission.PROJECT_MEMBERS_MANAGE) as (
        session,
        project,
        current,
    ):
        old_role = await repository.get_project_member(session, project.id, user_id)
        if old_role is None:
            raise not_found()
        metadata: dict[str, audit.MetadataValue]
        if remove:
            await repository.remove_project_member(session, project.id, user_id)
            action, metadata = "project.member.removed", {"project": project.key, "role": old_role}
        elif role is not None and role != old_role:
            if project.archived_at is not None:
                raise project_archived()
            await repository.set_project_member_role(session, project.id, user_id, role)
            action = "project.member.role_changed"
            metadata = {"project": project.key, "old_role": old_role, "new_role": role}
        else:
            return
        await audit.record(
            session,
            action,
            client,
            actor_user_id=current.org.user_id,
            target_type="user",
            target_id=str(user_id),
            metadata=metadata,
        )
