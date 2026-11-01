"""Issue story points enforcement against org/project settings (B3)."""

from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.orgs import repository as orgs_repository
from app.modules.projects import settings_repository
from app.modules.projects.settings_service_errors import project_settings_conflict
from app.modules.projects.story_points_effective import (
    resolve_story_points_settings,
    stored_override_conflicts,
)

_STORY_POINTS_DISABLED: Final = (
    "Story Points are not enabled for this project under the current organization settings."
)


@dataclass(frozen=True, slots=True)
class IssueStoryPointsPolicy:
    effective_enabled: bool
    effective_max: int
    conflict_fields: tuple[str, ...]


async def load_issue_story_points_policy(
    session: AsyncSession, project_id: UUID
) -> IssueStoryPointsPolicy:
    org = await orgs_repository.get_organization_settings(session)
    overrides = await settings_repository.get_project_settings_overrides(session, project_id)
    conflicts = stored_override_conflicts(
        org_enabled=org.story_points_enabled,
        org_max=org.story_points_max,
        enabled_override=overrides.story_points_enabled_override,
        max_override=overrides.story_points_max_override,
    )
    resolved = resolve_story_points_settings(
        org_enabled=org.story_points_enabled,
        org_max=org.story_points_max,
        enabled_override=overrides.story_points_enabled_override,
        max_override=overrides.story_points_max_override,
    )
    return IssueStoryPointsPolicy(
        effective_enabled=resolved.effective.story_points_enabled,
        effective_max=resolved.effective.story_points_max,
        conflict_fields=tuple(conflicts),
    )


def validate_story_points_mutation(
    policy: IssueStoryPointsPolicy,
    requested: int | None,
    current: int | None,
) -> None:
    """Reject illegal estimate changes; no-op and clear (null) always pass."""
    if requested == current:
        return
    if requested is None:
        return
    if policy.conflict_fields:
        raise project_settings_conflict(list(policy.conflict_fields))
    if not policy.effective_enabled:
        raise AppError(
            422,
            "story_points_disabled",
            _STORY_POINTS_DISABLED,
            errors=[{"field": "body.story_points", "message": _STORY_POINTS_DISABLED}],
        )
    if requested > policy.effective_max:
        message = f"Cannot exceed the effective maximum ({policy.effective_max})."
        raise AppError(
            422,
            "story_points_exceeds_max",
            message,
            errors=[{"field": "body.story_points", "message": message}],
        )
