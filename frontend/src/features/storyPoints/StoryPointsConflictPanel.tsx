import { Link } from 'react-router';

import { Button } from '../../components/ui/Button';
import { FormError } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import type { OrgSettings } from '../../lib/api/types';
import { describeError } from '../../lib/forms';

import { useUpdateProjectSettings } from '../projects/api';
import {
  conflictFieldExplanation,
  conflictFieldLabel,
  conflictFieldsFromError,
  formatEnabledLabel,
} from './storyPointsSettingsUx';

export function StoryPointsConflictPanel({
  orgSlug,
  projectKey,
  conflict,
  orgSettings,
  canRecover,
  archived,
}: {
  orgSlug: string;
  projectKey: string;
  conflict: ApiError;
  orgSettings: OrgSettings;
  /** When false, show guidance only (no PATCH recovery). */
  canRecover: boolean;
  archived: boolean;
}) {
  const update = useUpdateProjectSettings(orgSlug, projectKey);
  const fields = conflictFieldsFromError(conflict);
  const adminGeneral = `/o/${encodeURIComponent(orgSlug)}/admin/general#org-settings-story-points`;

  const recoveryBlocked = archived || !canRecover;
  const patchFailure =
    update.error && !(update.error instanceof ApiError && update.error.status === 409)
      ? describeError(update.error)
      : null;

  const clearField = (field: 'story_points_enabled_override' | 'story_points_max_override') => {
    if (recoveryBlocked) return;
    void update.mutateAsync({ [field]: null });
  };

  const setMaxToOrg = () => {
    if (recoveryBlocked) return;
    void update.mutateAsync({
      story_points_max_override: orgSettings.story_points_max,
    });
  };

  return (
    <div
      role="alert"
      className="space-y-3 rounded-lg border border-warning/50 bg-[color-mix(in_srgb,var(--admin-warning,var(--color-warning))_8%,transparent)] p-4"
    >
      <h3 className="text-sm font-semibold text-fg">Project overrides conflict with organization settings</h3>
      <p className="text-sm text-fg-muted">
        {conflict.detail ??
          'Project overrides no longer match organization settings. Update or reset the conflicting override fields.'}
      </p>
      <dl className="grid gap-2 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-fg-muted">
          <span id="story-points-conflict-org-policy">Organization policy</span>
        </dt>
        <dd className="text-fg" aria-labelledby="story-points-conflict-org-policy">
          {formatEnabledLabel(orgSettings.story_points_enabled)} · maximum{' '}
          {orgSettings.story_points_max}
        </dd>
      </dl>
      {fields.length > 0 ? (
        <ul className="list-disc space-y-2 pl-5 text-sm text-fg-muted">
          {fields.map((field) => (
            <li key={field}>
              <span className="font-medium text-fg">{conflictFieldLabel(field)}</span>
              {' — '}
              {conflictFieldExplanation(field, orgSettings)}
            </li>
          ))}
        </ul>
      ) : null}
      {archived ? (
        <p className="text-sm text-fg-muted">
          This project is archived and read-only. Unarchive the project before resolving override
          conflicts.
        </p>
      ) : !canRecover ? (
        <p className="text-sm text-fg-muted">
          You need project manage permission to clear or update overrides.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {fields.includes('story_points_enabled_override') ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={update.isPending}
              onClick={() => {
                clearField('story_points_enabled_override');
              }}
            >
              Clear enable override
            </Button>
          ) : null}
          {fields.includes('story_points_max_override') ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={update.isPending}
                onClick={() => {
                  clearField('story_points_max_override');
                }}
              >
                Clear maximum override
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={update.isPending}
                onClick={() => {
                  setMaxToOrg();
                }}
              >
                Set maximum to {orgSettings.story_points_max}
              </Button>
            </>
          ) : null}
        </div>
      )}
      <p className="text-sm text-fg-muted">
        Organization owners and admins can adjust workspace defaults on{' '}
        <Link to={adminGeneral} className="text-accent underline-offset-2 hover:underline">
          General settings
        </Link>
        .
      </p>
      <FormError>{patchFailure}</FormError>
    </div>
  );
}
