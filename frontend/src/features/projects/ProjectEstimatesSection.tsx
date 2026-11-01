import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm, useWatch, type UseFormSetError } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';

import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FormError, SubmitButton } from '../../components/ui/Form';
import { Field } from '../../components/ui/Input';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { OrgSettings, ProjectSettings, UpdateProjectSettingsRequest } from '../../lib/api/types';
import { describeError } from '../../lib/forms';
import { permissionDeniedInlineMessage } from '../../lib/ux/permissionDenied';
import { cn } from '../../lib/cn';
import { useOrgSettings } from '../orgs/api';
import { StoryPointsConflictPanel } from '../storyPoints/StoryPointsConflictPanel';
import {
  enabledChoiceFromOverride,
  enabledOverrideFromChoice,
  formatEnabledLabel,
  isProjectSettingsConflict,
  maxChoiceFromOverride,
  provenanceLabel,
  type EnabledOverrideChoice,
  type MaxOverrideChoice,
} from '../storyPoints/storyPointsSettingsUx';

import { useProjectSettings, useUpdateProjectSettings } from './api';

const selectClass = cn(
  'w-full max-w-md rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg',
  'outline-none focus:border-accent focus:ring-2 focus:ring-accent/20',
);

function projectMaxSchema(orgMax: number) {
  return z
    .number({ error: 'Use a whole number.' })
    .int('Use a whole number.')
    .min(1, 'Minimum is 1.')
    .max(orgMax, `Cannot exceed the organization maximum (${String(orgMax)}).`);
}

function buildFormSchema(orgMax: number) {
  return z
    .object({
      enabledChoice: z.enum(['inherit', 'enabled', 'disabled']),
      maxChoice: z.enum(['inherit', 'custom']),
      maxCustom: z.number(),
    })
    .superRefine((values, ctx) => {
      if (values.maxChoice === 'custom') {
        const parsed = projectMaxSchema(orgMax).safeParse(values.maxCustom);
        if (!parsed.success) {
          for (const issue of parsed.error.issues) {
            ctx.addIssue({ ...issue, path: ['maxCustom'] });
          }
        }
      }
    });
}

type FormValues = {
  enabledChoice: EnabledOverrideChoice;
  maxChoice: MaxOverrideChoice;
  maxCustom: number;
};

function valuesFromSettings(settings: ProjectSettings, orgMax: number): FormValues {
  const maxOverride = settings.overrides.story_points_max;
  return {
    enabledChoice: enabledChoiceFromOverride(settings.overrides.story_points_enabled),
    maxChoice: maxChoiceFromOverride(maxOverride),
    maxCustom: maxOverride ?? orgMax,
  };
}

function buildPartialPatch(
  initial: ProjectSettings['overrides'],
  values: FormValues,
): UpdateProjectSettingsRequest {
  const body: UpdateProjectSettingsRequest = {};
  const nextEnabled = enabledOverrideFromChoice(values.enabledChoice);
  if (nextEnabled !== initial.story_points_enabled) {
    body.story_points_enabled_override = nextEnabled;
  }
  const nextMax = values.maxChoice === 'inherit' ? null : values.maxCustom;
  if (nextMax !== initial.story_points_max) {
    body.story_points_max_override = nextMax;
  }
  return body;
}

function EffectiveSummary({ settings }: { settings: ProjectSettings }) {
  return (
    <div className="space-y-1">
      <h3 className="text-sm font-semibold text-fg">Effective for this project</h3>
      <p className="text-sm text-fg">
        {formatEnabledLabel(settings.effective.story_points_enabled)} · maximum{' '}
        {settings.effective.story_points_max}
      </p>
      <p className="text-xs text-fg-muted">Used when creating or editing issue story points.</p>
    </div>
  );
}

function ProvenanceBadge({ source }: { source: 'organization' | 'project' }) {
  return (
    <Badge tone={source === 'project' ? 'info' : 'neutral'}>{provenanceLabel(source)}</Badge>
  );
}

function ReadOnlyEstimates({
  settings,
  orgEnabled,
  orgMax,
  orgSlug,
}: {
  settings: ProjectSettings;
  orgEnabled: boolean;
  orgMax: number;
  orgSlug: string;
}) {
  const adminGeneral = `/o/${encodeURIComponent(orgSlug)}/admin/general#org-settings-story-points`;
  return (
    <div className="space-y-4 text-sm">
      <EffectiveSummary settings={settings} />
      <div>
        <h3 className="font-semibold text-fg">Organization defaults</h3>
        <p className="mt-1 text-fg-muted">
          {formatEnabledLabel(orgEnabled)} · maximum {orgMax}
        </p>
        <Link to={adminGeneral} className="text-accent underline-offset-2 hover:underline">
          View organization settings
        </Link>
      </div>
      <dl className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-fg-muted">Enable story points</dt>
          <dd className="flex flex-wrap items-center gap-2 text-fg">
            {settings.overrides.story_points_enabled === null
              ? 'Inherit organization'
              : formatEnabledLabel(settings.overrides.story_points_enabled)}
            <ProvenanceBadge source={settings.provenance.story_points_enabled} />
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-fg-muted">Maximum story points</dt>
          <dd className="flex flex-wrap items-center gap-2 text-fg">
            {settings.overrides.story_points_max === null
              ? `Inherit organization (${String(orgMax)})`
              : String(settings.overrides.story_points_max)}
            <ProvenanceBadge source={settings.provenance.story_points_max} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function mapSettingsValidationErrors(error: ApiError, setError: UseFormSetError<FormValues>) {
  for (const fieldError of error.fieldErrors) {
    const name = fieldError.field.replace(/^body\./, '');
    if (name === 'story_points_enabled_override') {
      setError('enabledChoice', { type: 'server', message: fieldError.message });
    } else if (name === 'story_points_max_override') {
      setError('maxCustom', { type: 'server', message: fieldError.message });
    }
  }
}

function EstimatesForm({
  orgSlug,
  projectKey,
  settings,
  orgSettings,
  archived,
}: {
  orgSlug: string;
  projectKey: string;
  settings: ProjectSettings;
  orgSettings: OrgSettings;
  archived: boolean;
}) {
  const orgEnabled = orgSettings.story_points_enabled;
  const orgMax = orgSettings.story_points_max;
  const update = useUpdateProjectSettings(orgSlug, projectKey);
  const schema = buildFormSchema(orgMax);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valuesFromSettings(settings, orgMax),
  });

  useEffect(() => {
    form.reset(valuesFromSettings(settings, orgMax));
  }, [settings, orgMax, form]);

  const maxChoice = useWatch({ control: form.control, name: 'maxChoice' });

  const onSubmit = form.handleSubmit(async (values) => {
    const body = buildPartialPatch(settings.overrides, values);
    if (Object.keys(body).length === 0) return;
    try {
      await update.mutateAsync(body);
      form.reset(values);
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        mapSettingsValidationErrors(error, form.setError);
      }
    }
  });

  const resetAll = () => {
    if (archived) return;
    void update.mutateAsync({
      story_points_enabled_override: null,
      story_points_max_override: null,
    });
  };

  const failureRaw = update.error;
  const failure =
    failureRaw && !(failureRaw instanceof ApiError && failureRaw.status === 422)
      ? (permissionDeniedInlineMessage(failureRaw, 'project-settings') ??
        (isProjectSettingsConflict(failureRaw)
          ? null
          : describeError(failureRaw)))
      : null;

  const adminGeneral = `/o/${encodeURIComponent(orgSlug)}/admin/general#org-settings-story-points`;
  const enableOnDisabled = !orgEnabled;

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-lg space-y-5">
      <EffectiveSummary settings={settings} />
      <div className="text-sm">
        <h3 className="font-semibold text-fg">Organization defaults</h3>
        <p className="mt-1 text-fg-muted">
          {formatEnabledLabel(orgEnabled)} · maximum {orgMax}
        </p>
        <Link to={adminGeneral} className="text-accent underline-offset-2 hover:underline">
          Change organization defaults
        </Link>
      </div>
      <FormError>{failure}</FormError>
      {isProjectSettingsConflict(update.error) ? (
        <StoryPointsConflictPanel
          orgSlug={orgSlug}
          projectKey={projectKey}
          conflict={update.error}
          orgSettings={orgSettings}
          canRecover={!archived}
          archived={archived}
        />
      ) : null}
      {update.isSuccess ? (
        <p role="status" className="text-sm text-fg">
          Estimates settings saved.
        </p>
      ) : null}
      <Field
        label="Enable story points"
        error={form.formState.errors.enabledChoice?.message ?? null}
      >
        {(field) => (
          <div className="flex flex-wrap items-center gap-2">
            <select
              id={field.id}
              className={selectClass}
              disabled={archived}
              aria-invalid={field['aria-invalid']}
              aria-describedby={field['aria-describedby']}
              {...form.register('enabledChoice')}
            >
              <option value="inherit">Inherit organization</option>
              <option value="enabled" disabled={enableOnDisabled}>
                Enabled
              </option>
              <option value="disabled">Disabled</option>
            </select>
            <ProvenanceBadge source={settings.provenance.story_points_enabled} />
          </div>
        )}
      </Field>
      {enableOnDisabled ? (
        <p className="text-xs text-fg-muted">
          Story points are disabled for the organization. You cannot enable them for this project
          only. Inherit or set Disabled to align with organization policy.
        </p>
      ) : null}
      <Field
        label="Maximum story points"
        error={form.formState.errors.maxCustom?.message ?? null}
      >
        {(field) => (
          <div className="space-y-2">
            <select
              id={field.id}
              className={selectClass}
              disabled={archived}
              aria-invalid={field['aria-invalid']}
              aria-describedby={field['aria-describedby']}
              {...form.register('maxChoice')}
            >
              <option value="inherit">Inherit organization ({orgMax})</option>
              <option value="custom">Custom maximum</option>
            </select>
            {maxChoice === 'custom' ? (
              <input
                id={field.id}
                type="number"
                min={1}
                max={orgMax}
                step={1}
                disabled={archived}
                className={selectClass}
                aria-invalid={field['aria-invalid']}
                aria-describedby={field['aria-describedby']}
                {...form.register('maxCustom', { valueAsNumber: true })}
              />
            ) : null}
            <ProvenanceBadge source={settings.provenance.story_points_max} />
          </div>
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pending={update.isPending} disabled={archived || !form.formState.isDirty}>
          Save estimates settings
        </SubmitButton>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={archived || update.isPending}
          onClick={resetAll}
        >
          Reset to organization defaults
        </Button>
      </div>
      {archived ? (
        <p className="text-sm text-fg-muted">
          This project is archived and read-only. Unarchive it to change estimates settings.
        </p>
      ) : null}
    </form>
  );
}

export function ProjectEstimatesSection({
  orgSlug,
  projectKey,
  canManage,
  archived,
}: {
  orgSlug: string;
  projectKey: string;
  canManage: boolean;
  archived: boolean;
}) {
  const orgSettings = useOrgSettings(orgSlug);
  const projectSettings = useProjectSettings(orgSlug, projectKey);

  if (orgSettings.isPending || projectSettings.isPending) {
    return <LoadingState label="Loading estimates settings" />;
  }
  if (orgSettings.isError) {
    return <ErrorState error={orgSettings.error} onRetry={() => void orgSettings.refetch()} />;
  }

  const org = orgSettings.data;
  if (projectSettings.isError && isProjectSettingsConflict(projectSettings.error)) {
    const conflictError = projectSettings.error;
    return (
      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-fg">Estimates</h2>
        <p className="text-sm text-fg-muted">
          Project override data could not be loaded because it conflicts with organization settings.
          Resolve the conflict below using organization policy as the source of truth.
        </p>
        <StoryPointsConflictPanel
          orgSlug={orgSlug}
          projectKey={projectKey}
          conflict={conflictError}
          orgSettings={org}
          canRecover={canManage && !archived}
          archived={archived}
        />
      </Card>
    );
  }

  if (projectSettings.isError) {
    return (
      <ErrorState error={projectSettings.error} onRetry={() => void projectSettings.refetch()} />
    );
  }

  const settings = projectSettings.data;

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-fg">Estimates</h2>
      <p className="text-sm text-fg-muted">
        Story point limits for this project. Organization defaults apply unless you set overrides
        below.
      </p>
      {canManage && !archived ? (
        <EstimatesForm
          orgSlug={orgSlug}
          projectKey={projectKey}
          settings={settings}
          orgSettings={org}
          archived={archived}
        />
      ) : (
        <ReadOnlyEstimates
          settings={settings}
          orgEnabled={org.story_points_enabled}
          orgMax={org.story_points_max}
          orgSlug={orgSlug}
        />
      )}
      {archived && canManage ? (
        <p className="text-sm text-fg-muted">
          This project is archived and read-only. Unarchive it to change estimates settings.
        </p>
      ) : null}
    </Card>
  );
}
