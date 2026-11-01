"""Data access for project_settings (B2)."""

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.tenant import require_org_context
from app.modules.projects.models import ProjectSettings


@dataclass(frozen=True, slots=True)
class ProjectSettingsOverrides:
    story_points_enabled_override: bool | None
    story_points_max_override: int | None
    updated_at: datetime | None


async def get_project_settings_overrides(
    session: AsyncSession, project_id: uuid.UUID
) -> ProjectSettingsOverrides:
    context = require_org_context(session)
    row = (
        await session.execute(
            select(
                ProjectSettings.story_points_enabled_override,
                ProjectSettings.story_points_max_override,
                ProjectSettings.updated_at,
            ).where(
                ProjectSettings.org_id == context.org_id,
                ProjectSettings.project_id == project_id,
            )
        )
    ).one_or_none()
    if row is None:
        return ProjectSettingsOverrides(None, None, None)
    return ProjectSettingsOverrides(
        story_points_enabled_override=row.story_points_enabled_override,
        story_points_max_override=row.story_points_max_override,
        updated_at=row.updated_at,
    )


async def apply_project_settings_overrides(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    enabled_override: bool | None,
    max_override: int | None,
) -> ProjectSettingsOverrides:
    """Persist overrides; delete the row when both columns are NULL."""
    context = require_org_context(session)
    current = await get_project_settings_overrides(session, project_id)

    if enabled_override is None and max_override is None:
        await session.execute(
            delete(ProjectSettings).where(
                ProjectSettings.org_id == context.org_id,
                ProjectSettings.project_id == project_id,
            )
        )
        return ProjectSettingsOverrides(None, None, None)

    if current.updated_at is None:
        await session.execute(
            insert(ProjectSettings).values(
                org_id=context.org_id,
                project_id=project_id,
                story_points_enabled_override=enabled_override,
                story_points_max_override=max_override,
            )
        )
    else:
        await session.execute(
            update(ProjectSettings)
            .where(
                ProjectSettings.org_id == context.org_id,
                ProjectSettings.project_id == project_id,
            )
            .values(
                story_points_enabled_override=enabled_override,
                story_points_max_override=max_override,
                updated_at=func.now(),
            )
        )
    return await get_project_settings_overrides(session, project_id)
