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
