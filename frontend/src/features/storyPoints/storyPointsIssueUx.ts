import { ApiError } from '../../lib/api/errors';

export const STORY_POINTS_INPUT_INVALID = 'Use a whole number from 0 to 100.';

export function storyPointsRangeMessage(max: number): string {
  return `Use a whole number from 0 to ${String(max)}.`;
}

export type ParsedStoryPointsInput =
  | { kind: 'empty' }
  | { kind: 'value'; value: number }
  | { kind: 'invalid' };

/** Empty input means no estimate; otherwise a whole number. */
export function parseStoryPointsInput(text: string): ParsedStoryPointsInput {
  const trimmed = text.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (!/^\d{1,3}$/.test(trimmed)) return { kind: 'invalid' };
  const value = Number(trimmed);
  if (value > 100) return { kind: 'invalid' };
  return { kind: 'value', value };
}

export function clientStoryPointsInputError(
  text: string,
  effectiveMax: number,
): string | null {
  const parsed = parseStoryPointsInput(text);
  if (parsed.kind === 'invalid') {
    return storyPointsRangeMessage(effectiveMax);
  }
  if (parsed.kind === 'value' && parsed.value > effectiveMax) {
    return storyPointsRangeMessage(effectiveMax);
  }
  return null;
}

export type IssueStoryPointsPolicyReady = {
  effectiveEnabled: boolean;
  effectiveMax: number;
};

export function canSubmitStoryPointsChange(args: {
  current: number | null;
  parsed: ParsedStoryPointsInput;
  policy: IssueStoryPointsPolicyReady | null;
  settingsConflict?: boolean;
}): { allowed: true; next: number | null } | { allowed: false; reason: string } {
  const { current, parsed, policy, settingsConflict = false } = args;
  if (parsed.kind === 'invalid') {
    const max = policy?.effectiveMax ?? 100;
    return { allowed: false, reason: storyPointsRangeMessage(max) };
  }
  const next = parsed.kind === 'empty' ? null : parsed.value;
  if (next === current) {
    return { allowed: true, next };
  }
  if (next === null) {
    return { allowed: true, next };
  }
  if (settingsConflict) {
    return {
      allowed: false,
      reason:
        'Project estimate settings conflict with organization policy. Resolve on the Estimates tab first.',
    };
  }
  if (!policy) {
    return {
      allowed: false,
      reason: 'Estimate policy is still loading. Try again in a moment.',
    };
  }
  if (policy.effectiveMax < next) {
    return { allowed: false, reason: storyPointsRangeMessage(policy.effectiveMax) };
  }
  if (!policy.effectiveEnabled) {
    return {
      allowed: false,
      reason: 'Story points are not enabled for this project. You can clear the estimate.',
    };
  }
  return { allowed: true, next };
}

export function estimatesSettingsHref(org: string, projectKey: string): string {
  return `/o/${encodeURIComponent(org)}/p/${encodeURIComponent(projectKey)}?tab=estimates`;
}

function storyPointsFieldMessage(error: ApiError): string | null {
  for (const fieldError of error.fieldErrors) {
    if (fieldError.field.replace(/^body\./, '') === 'story_points') {
      return fieldError.message;
    }
  }
  return null;
}

export function storyPointsMutationFieldMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const api = error;
  if (api.code === 'project_settings_conflict') {
    return (
      api.detail ??
      'Project estimate settings conflict with organization policy. Resolve overrides on the Estimates tab before setting story points.'
    );
  }
  if (api.code === 'story_points_disabled') {
    return (
      storyPointsFieldMessage(api) ??
      api.detail ??
      'Story points are not enabled for this project.'
    );
  }
  if (api.code === 'story_points_exceeds_max') {
    return (
      storyPointsFieldMessage(api) ??
      api.detail ??
      'Story points exceed the effective maximum.'
    );
  }
  return null;
}
