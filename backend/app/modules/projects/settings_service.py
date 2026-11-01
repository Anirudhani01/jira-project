"""Project settings use cases (B2)."""

from app.authz.permissions import Permission
from app.authz.projects import ProjectAccess, project_transaction
from app.modules.audit import service as audit
from app.modules.identity.deps import IdentityServices
from app.modules.orgs import repository as orgs_repository
from app.modules.projects import settings_repository
from app.modules.projects.models import Project
from app.modules.projects.settings_schemas import (
    ProjectSettingsResponse,
    StoryPointsOverrides,
    StoryPointsProvenanceResponse,
    StoryPointsValues,
    UpdateProjectSettingsRequest,
)
from app.modules.projects.settings_service_errors import (
    project_archived,
    project_settings_conflict,
    validation_error,
)
from app.modules.projects.story_points_effective import (
    resolve_story_points_settings,
    stored_override_conflicts,
)
from app.modules.security_events.service import ClientInfo

_SENTINEL = object()

type EnabledPatch = bool | object | None
type MaxPatch = int | object | None


def _response(
    *,
    org_enabled: bool,
    org_max: int,
    enabled_override: bool | None,
    max_override: int | None,
    updated_at: object,
) -> ProjectSettingsResponse:
    resolved = resolve_story_points_settings(
        org_enabled=org_enabled,
        org_max=org_max,
        enabled_override=enabled_override,
        max_override=max_override,
    )
    return ProjectSettingsResponse(
        organization=StoryPointsValues(
            story_points_enabled=resolved.organization.story_points_enabled,
            story_points_max=resolved.organization.story_points_max,
        ),
        overrides=StoryPointsOverrides(
            story_points_enabled=enabled_override,
            story_points_max=max_override,
        ),
        effective=StoryPointsValues(
            story_points_enabled=resolved.effective.story_points_enabled,
            story_points_max=resolved.effective.story_points_max,
        ),
        provenance=StoryPointsProvenanceResponse(
            story_points_enabled=resolved.provenance.story_points_enabled,
            story_points_max=resolved.provenance.story_points_max,
        ),
        updated_at=updated_at,  # type: ignore[arg-type]
    )


def _ensure_no_stored_conflicts(
    *,
    org_enabled: bool,
    org_max: int,
    enabled_override: bool | None,
    max_override: int | None,
) -> None:
    conflicts = stored_override_conflicts(
        org_enabled=org_enabled,
        org_max=org_max,
        enabled_override=enabled_override,
        max_override=max_override,
    )
    if conflicts:
        raise project_settings_conflict(conflicts)


def _validate_patch_values(
    *,
    org_enabled: bool,
    org_max: int,
    enabled_override: EnabledPatch,
    max_override: MaxPatch,
) -> None:
    if enabled_override is not _SENTINEL and enabled_override is True and not org_enabled:
        raise validation_error(
            "story_points_enabled_override",
            "Story Points are disabled for the organization.",
        )
    if max_override is not _SENTINEL and max_override is not None and max_override > org_max:
        raise validation_error(
            "story_points_max_override",
            f"Cannot exceed the organization maximum ({org_max}).",
        )


def _changed_fields(
    current: settings_repository.ProjectSettingsOverrides,
    *,
    enabled_override: EnabledPatch,
    max_override: MaxPatch,
) -> list[str]:
    changed: list[str] = []
    if enabled_override is not _SENTINEL:
        value = enabled_override
        if value != current.story_points_enabled_override:
            changed.append("story_points_enabled_override")
    if max_override is not _SENTINEL:
        value = max_override
        if value != current.story_points_max_override:
            changed.append("story_points_max_override")
    return sorted(changed)


async def get_project_settings(
    services: IdentityServices, access: ProjectAccess
) -> ProjectSettingsResponse:
    async with project_transaction(services, access, Permission.PROJECT_VIEW) as (
        session,
        project,
        _,
    ):
        org = await orgs_repository.get_organization_settings(session)
        overrides = await settings_repository.get_project_settings_overrides(session, project.id)
        _ensure_no_stored_conflicts(
            org_enabled=org.story_points_enabled,
            org_max=org.story_points_max,
            enabled_override=overrides.story_points_enabled_override,
            max_override=overrides.story_points_max_override,
        )
        return _response(
            org_enabled=org.story_points_enabled,
            org_max=org.story_points_max,
            enabled_override=overrides.story_points_enabled_override,
            max_override=overrides.story_points_max_override,
            updated_at=overrides.updated_at,
        )


async def update_project_settings(
    services: IdentityServices,
    access: ProjectAccess,
    body: UpdateProjectSettingsRequest,
    *,
    client: ClientInfo,
) -> ProjectSettingsResponse:
    fields_set = body.model_fields_set
    enabled_patch: EnabledPatch = (
        body.story_points_enabled_override
        if "story_points_enabled_override" in fields_set
        else _SENTINEL
    )
    max_patch: MaxPatch = (
        body.story_points_max_override if "story_points_max_override" in fields_set else _SENTINEL
    )

    async with project_transaction(services, access, Permission.PROJECT_MANAGE) as (
        session,
        project,
        current,
    ):
        _ensure_project_writable(project)
        org = await orgs_repository.get_organization_settings(session)
        current_overrides = await settings_repository.get_project_settings_overrides(
            session, project.id
        )
        _validate_patch_values(
            org_enabled=org.story_points_enabled,
            org_max=org.story_points_max,
            enabled_override=enabled_patch,
            max_override=max_patch,
        )
        changed = _changed_fields(
            current_overrides,
            enabled_override=enabled_patch,
            max_override=max_patch,
        )
        if not changed:
            _ensure_no_stored_conflicts(
                org_enabled=org.story_points_enabled,
                org_max=org.story_points_max,
                enabled_override=current_overrides.story_points_enabled_override,
                max_override=current_overrides.story_points_max_override,
            )
            return _response(
                org_enabled=org.story_points_enabled,
                org_max=org.story_points_max,
                enabled_override=current_overrides.story_points_enabled_override,
                max_override=current_overrides.story_points_max_override,
                updated_at=current_overrides.updated_at,
            )

        new_enabled = (
            current_overrides.story_points_enabled_override
            if enabled_patch is _SENTINEL
            else enabled_patch
        )
        new_max = (
            current_overrides.story_points_max_override if max_patch is _SENTINEL else max_patch
        )
        _validate_patch_values(
            org_enabled=org.story_points_enabled,
            org_max=org.story_points_max,
            enabled_override=new_enabled,
            max_override=new_max,
        )

        updated = await settings_repository.apply_project_settings_overrides(
            session,
            project.id,
            enabled_override=new_enabled,
            max_override=new_max,
        )
        _ensure_no_stored_conflicts(
            org_enabled=org.story_points_enabled,
            org_max=org.story_points_max,
            enabled_override=updated.story_points_enabled_override,
            max_override=updated.story_points_max_override,
        )
        await audit.record(
            session,
            "project.settings.updated",
            client,
            actor_user_id=current.org.user_id,
            target_type="project",
            target_id=str(project.id),
            metadata={"project": project.key, "fields": ",".join(changed)},
        )
        return _response(
            org_enabled=org.story_points_enabled,
            org_max=org.story_points_max,
            enabled_override=updated.story_points_enabled_override,
            max_override=updated.story_points_max_override,
            updated_at=updated.updated_at,
        )


def _ensure_project_writable(project: Project) -> None:
    if project.archived_at is not None:
        raise project_archived()
