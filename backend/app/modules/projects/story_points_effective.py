"""Effective story points settings from organization defaults and project overrides (B2, B3)."""

from dataclasses import dataclass
from typing import Literal

Provenance = Literal["organization", "project"]


@dataclass(frozen=True, slots=True)
class StoryPointsLayer:
    story_points_enabled: bool
    story_points_max: int


@dataclass(frozen=True, slots=True)
class StoryPointsProvenance:
    story_points_enabled: Provenance
    story_points_max: Provenance


@dataclass(frozen=True, slots=True)
class ResolvedStoryPointsSettings:
    organization: StoryPointsLayer
    effective: StoryPointsLayer
    provenance: StoryPointsProvenance


def effective_story_points_enabled(
    org_enabled: bool, enabled_override: bool | None
) -> bool:
    inherit_enabled = True if enabled_override is None else enabled_override
    return org_enabled and inherit_enabled


def effective_story_points_max(org_max: int, max_override: int | None) -> int:
    return org_max if max_override is None else max_override


def resolve_story_points_settings(
    *,
    org_enabled: bool,
    org_max: int,
    enabled_override: bool | None,
    max_override: int | None,
) -> ResolvedStoryPointsSettings:
    organization = StoryPointsLayer(
        story_points_enabled=org_enabled, story_points_max=org_max
    )
    effective = StoryPointsLayer(
        story_points_enabled=effective_story_points_enabled(org_enabled, enabled_override),
        story_points_max=effective_story_points_max(org_max, max_override),
    )
    provenance = StoryPointsProvenance(
        story_points_enabled="project" if enabled_override is not None else "organization",
        story_points_max="project" if max_override is not None else "organization",
    )
    return ResolvedStoryPointsSettings(
        organization=organization,
        effective=effective,
        provenance=provenance,
    )


def stored_override_conflicts(
    *,
    org_enabled: bool,
    org_max: int,
    enabled_override: bool | None,
    max_override: int | None,
) -> list[str]:
    """Fields stored on the project that contradict current organization settings."""
    conflicts: list[str] = []
    if not org_enabled and enabled_override is True:
        conflicts.append("story_points_enabled_override")
    if max_override is not None and max_override > org_max:
        conflicts.append("story_points_max_override")
    return sorted(conflicts)
