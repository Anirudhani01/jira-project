import { z } from 'zod';

import { ApiError } from '../../lib/api/errors';
import type { OrgSettings } from '../../lib/api/types';

export const PROJECT_SETTINGS_CONFLICT_CODE = 'project_settings_conflict';

export const orgStoryPointsMaxSchema = z
  .number({ error: 'Use a whole number.' })
  .int('Use a whole number.')
  .min(1, 'Minimum is 1.')
  .max(100, 'Maximum is 100.');

export const orgStoryPointsFormSchema = z.object({
  story_points_enabled: z.boolean(),
  story_points_max: orgStoryPointsMaxSchema,
});

export type OrgStoryPointsFormValues = z.infer<typeof orgStoryPointsFormSchema>;

export type EnabledOverrideChoice = 'inherit' | 'enabled' | 'disabled';
export type MaxOverrideChoice = 'inherit' | 'custom';

export function enabledChoiceFromOverride(value: boolean | null): EnabledOverrideChoice {
  if (value === null) return 'inherit';
  return value ? 'enabled' : 'disabled';
}

export function enabledOverrideFromChoice(choice: EnabledOverrideChoice): boolean | null {
  if (choice === 'inherit') return null;
  return choice === 'enabled';
}

export function maxChoiceFromOverride(value: number | null): MaxOverrideChoice {
  return value === null ? 'inherit' : 'custom';
}

export function isProjectSettingsConflict(error: unknown): error is ApiError {
  return error instanceof ApiError && error.code === PROJECT_SETTINGS_CONFLICT_CODE;
}

export function conflictFieldsFromError(error: ApiError): string[] {
  return error.fieldErrors.map((e) => e.field);
}

const CONFLICT_FIELD_LABELS: Record<string, string> = {
  story_points_enabled_override: 'Enable story points override',
  story_points_max_override: 'Maximum story points override',
};

export function conflictFieldLabel(field: string): string {
  return CONFLICT_FIELD_LABELS[field] ?? field;
}

export function conflictFieldExplanation(
  field: string,
  org: Pick<OrgSettings, 'story_points_enabled' | 'story_points_max'>,
): string {
  if (field === 'story_points_enabled_override') {
    return org.story_points_enabled
      ? 'The project stored an enable override that no longer matches organization policy.'
      : 'Story points are disabled for the organization, but this project still has an override that tries to enable them.';
  }
  if (field === 'story_points_max_override') {
    return `The project maximum override is higher than the organization maximum (${String(org.story_points_max)}).`;
  }
  return 'This override conflicts with current organization settings.';
}

export function formatEnabledLabel(enabled: boolean): string {
  return enabled ? 'Enabled' : 'Disabled';
}

export function provenanceLabel(source: 'organization' | 'project'): string {
  return source === 'project' ? 'Project override' : 'Organization';
}
