import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Field } from '../../components/ui/Input';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { FormError, SubmitButton, TextField } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import { applyServerErrors, describeError } from '../../lib/forms';
import { cn } from '../../lib/cn';
import {
  formatEnabledLabel,
  orgStoryPointsFormSchema,
  type OrgStoryPointsFormValues,
} from '../storyPoints/storyPointsSettingsUx';

import { useOrgSettings, useUpdateOrgSettings } from './api';

const checkboxClass = cn(
  'size-4 rounded border border-[var(--admin-border)] accent-[var(--admin-accent)]',
);

function ReadOnlyStoryPoints({ enabled, max }: { enabled: boolean; max: number }) {
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="font-medium text-[var(--admin-muted)]">Story points</dt>
        <dd className="mt-1 text-[var(--admin-text)]">{formatEnabledLabel(enabled)}</dd>
      </div>
      <div>
        <dt className="font-medium text-[var(--admin-muted)]">Maximum value</dt>
        <dd className="mt-1 font-mono text-[var(--admin-text)]">{max}</dd>
      </div>
      <p className="text-[var(--admin-muted)]">
        Only organization owners and admins can change story points settings.
      </p>
    </dl>
  );
}

function StoryPointsForm({ slug, enabled, max }: { slug: string; enabled: boolean; max: number }) {
  const update = useUpdateOrgSettings(slug);
  const form = useForm<OrgStoryPointsFormValues>({
    resolver: zodResolver(orgStoryPointsFormSchema),
    defaultValues: { story_points_enabled: enabled, story_points_max: max },
  });

  useEffect(() => {
    form.reset({ story_points_enabled: enabled, story_points_max: max });
  }, [enabled, max, form]);

  const [watchedEnabled, watchedMax] = useWatch({
    control: form.control,
    name: ['story_points_enabled', 'story_points_max'],
  });

  const policyWarning = useMemo(() => {
    const disabling = enabled && !watchedEnabled;
    const loweringMax =
      typeof watchedMax === 'number' && !Number.isNaN(watchedMax) && watchedMax < max;
    if (disabling) {
      return 'Disabling story points may cause project enable overrides to conflict until project admins resolve them.';
    }
    if (loweringMax) {
      return 'Lowering the organization maximum may cause project maximum overrides to conflict until project admins resolve them.';
    }
    return null;
  }, [enabled, max, watchedEnabled, watchedMax]);

  const onSubmit = form.handleSubmit(async (values) => {
    const body: { story_points_enabled?: boolean; story_points_max?: number } = {};
    if (values.story_points_enabled !== enabled) {
      body.story_points_enabled = values.story_points_enabled;
    }
    if (values.story_points_max !== max) {
      body.story_points_max = values.story_points_max;
    }
    if (Object.keys(body).length === 0) return;
    try {
      await update.mutateAsync(body);
      form.reset(values);
    } catch (error) {
      applyServerErrors(error, ['story_points_max', 'story_points_enabled'], form.setError);
    }
  });

  const failure =
    update.error && !(update.error instanceof ApiError && update.error.status === 422)
      ? describeError(update.error)
      : null;

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-md space-y-4">
      <FormError>{failure}</FormError>
      {policyWarning ? (
        <p role="status" className="text-sm text-[var(--admin-muted)]">
          {policyWarning}
        </p>
      ) : null}
      {update.isSuccess ? (
        <p role="status" className="text-sm text-[var(--admin-text)]">
          Story points settings saved.
        </p>
      ) : null}
      <Field
        label="Enable story points"
        hint="When disabled, issues cannot set story points unless a project explicitly keeps them off."
        error={form.formState.errors.story_points_enabled?.message ?? null}
      >
        {(field) => (
          <label className="flex items-center gap-2 text-sm text-[var(--admin-text)]">
            <input
              id={field.id}
              type="checkbox"
              className={checkboxClass}
              aria-invalid={field['aria-invalid']}
              aria-describedby={field['aria-describedby']}
              {...form.register('story_points_enabled')}
            />
            Allow story points on issues in this organization
          </label>
        )}
      </Field>
      <TextField
        label="Maximum story points"
        type="number"
        min={1}
        max={100}
        step={1}
        inputMode="numeric"
        hint="Organization-wide cap (1–100). Applies when story points are enabled; kept when disabled."
        error={form.formState.errors.story_points_max?.message}
        {...form.register('story_points_max', { valueAsNumber: true })}
      />
      <SubmitButton pending={update.isPending} disabled={!form.formState.isDirty}>
        Save story points settings
      </SubmitButton>
    </form>
  );
}

export function OrgStoryPointsSection({ slug, canManage }: { slug: string; canManage: boolean }) {
  const settings = useOrgSettings(slug);

  if (settings.isPending) {
    return <LoadingState label="Loading story points settings" />;
  }
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }

  const { story_points_enabled, story_points_max } = settings.data;

  if (!canManage) {
    return <ReadOnlyStoryPoints enabled={story_points_enabled} max={story_points_max} />;
  }

  return <StoryPointsForm slug={slug} enabled={story_points_enabled} max={story_points_max} />;
}
