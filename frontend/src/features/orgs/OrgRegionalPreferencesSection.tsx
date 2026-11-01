import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Field } from '../../components/ui/Input';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { FormError, SubmitButton } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import { applyServerErrors, describeError } from '../../lib/forms';
import { cn } from '../../lib/cn';

import { useOrgSettings, useUpdateOrgSettings } from './api';
import { localeSelectOptions, timezoneSelectOptions } from './orgRegionalOptions';

const schema = z.object({
  timezone: z.string().min(1, 'Select a timezone.'),
  locale: z.string().min(1, 'Select a locale.'),
});

type FormValues = z.infer<typeof schema>;

const selectClass = cn(
  'w-full max-w-md rounded-lg border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text)]',
  'outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--admin-accent)_20%,transparent)]',
);

function ReadOnlyRegional({ timezone, locale }: { timezone: string; locale: string }) {
  return (
    <dl className="space-y-3 text-sm">
      <div>
        <dt className="font-medium text-[var(--admin-muted)]">Timezone</dt>
        <dd className="mt-1 font-mono text-[var(--admin-text)]">{timezone}</dd>
      </div>
      <div>
        <dt className="font-medium text-[var(--admin-muted)]">Locale</dt>
        <dd className="mt-1 font-mono text-[var(--admin-text)]">{locale}</dd>
      </div>
      <p className="text-[var(--admin-muted)]">
        Only organization owners and admins can change regional preferences.
      </p>
    </dl>
  );
}

function RegionalPreferencesForm({
  slug,
  timezone,
  locale,
}: {
  slug: string;
  timezone: string;
  locale: string;
}) {
  const update = useUpdateOrgSettings(slug);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { timezone, locale },
  });

  useEffect(() => {
    form.reset({ timezone, locale });
  }, [timezone, locale, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    if (values.timezone === timezone && values.locale === locale) return;
    const body: { timezone?: string; locale?: string } = {};
    if (values.timezone !== timezone) body.timezone = values.timezone;
    if (values.locale !== locale) body.locale = values.locale;
    try {
      await update.mutateAsync(body);
      form.reset(values);
    } catch (error) {
      applyServerErrors(error, ['timezone', 'locale'], form.setError);
    }
  });

  const failure =
    update.error && !(update.error instanceof ApiError && update.error.status === 422)
      ? describeError(update.error)
      : null;

  const timezoneOptions = timezoneSelectOptions(timezone);
  const localeOptions = localeSelectOptions(locale);

  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-md space-y-4">
      <FormError>{failure}</FormError>
      {update.isSuccess ? (
        <p role="status" className="text-sm text-[var(--admin-text)]">
          Regional preferences saved.
        </p>
      ) : null}
      <Field label="Timezone" error={form.formState.errors.timezone?.message ?? null}>
        {(field) => (
          <select
            id={field.id}
            className={selectClass}
            aria-invalid={field['aria-invalid']}
            aria-describedby={field['aria-describedby']}
            {...form.register('timezone')}
          >
            {timezoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Locale" error={form.formState.errors.locale?.message ?? null}>
        {(field) => (
          <select
            id={field.id}
            className={selectClass}
            aria-invalid={field['aria-invalid']}
            aria-describedby={field['aria-describedby']}
            {...form.register('locale')}
          >
            {localeOptions.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        )}
      </Field>
      <SubmitButton pending={update.isPending} disabled={!form.formState.isDirty}>
        Save preferences
      </SubmitButton>
    </form>
  );
}

export function OrgRegionalPreferencesSection({
  slug,
  canManage,
}: {
  slug: string;
  canManage: boolean;
}) {
  const settings = useOrgSettings(slug);

  if (settings.isPending) {
    return <LoadingState label="Loading regional preferences" />;
  }
  if (settings.isError) {
    return <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />;
  }

  const { timezone, locale } = settings.data;

  if (!canManage) {
    return <ReadOnlyRegional timezone={timezone} locale={locale} />;
  }

  return <RegionalPreferencesForm slug={slug} timezone={timezone} locale={locale} />;
}
