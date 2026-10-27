import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import { z } from 'zod';

import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ErrorState, LoadingState } from '../../../components/ui/States';
import { NotFoundPage } from '../../../app/pages/NotFoundPage';
import { ApiError } from '../../../lib/api/errors';
import type { Org } from '../../../lib/api/types';
import { applyServerErrors, describeError } from '../../../lib/forms';
import { useOrg, useRenameOrg } from '../api';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use at most 100 characters.'),
});

function RenameForm({ org }: { org: Org }) {
  const rename = useRenameOrg(org.slug);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: org.name },
  });
  const onSubmit = form.handleSubmit(async ({ name }) => {
    try {
      await rename.mutateAsync(name);
    } catch (error) {
      applyServerErrors(error, ['name'], form.setError);
    }
  });
  const failure =
    rename.error && !(rename.error instanceof ApiError && rename.error.status === 422)
      ? describeError(rename.error)
      : null;
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-sm space-y-3">
      <FormError>{failure}</FormError>
      {rename.isSuccess ? <p role="status">Name saved.</p> : null}
      <TextField
        label="Name"
        error={form.formState.errors.name?.message}
        {...form.register('name')}
      />
      <p className="text-sm text-slate-600">
        Address: <code>/o/{org.slug}</code> (cannot be changed)
      </p>
      <SubmitButton pending={rename.isPending}>Save</SubmitButton>
    </form>
  );
}

export function OrgSettingsPage() {
  const { org: slug = '' } = useParams();
  const org = useOrg(slug);

  if (org.isPending) return <LoadingState label="Loading organization" />;
  if (org.error instanceof ApiError && org.error.status === 404) return <NotFoundPage />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => void org.refetch()} />;

  return (
    <section aria-labelledby="org-settings-title" className="space-y-6">
      <h1 id="org-settings-title" className="text-2xl font-semibold">
        Organization settings
      </h1>
      {org.data.permissions.includes('org.manage') ? (
        <RenameForm org={org.data} />
      ) : (
        <p role="alert">You don&apos;t have permission to change this organization.</p>
      )}
    </section>
  );
}
