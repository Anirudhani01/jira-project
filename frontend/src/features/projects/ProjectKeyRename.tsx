import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { Button } from '../../components/ui/Button';
import { FormError, SubmitButton, TextField } from '../../components/ui/Form';
import { ApiError } from '../../lib/api/errors';
import { applyServerErrors, describeError } from '../../lib/forms';
import { useOrg } from '../orgs/api';

import { useRenameProjectKey } from './api';

const schema = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/, 'Use 2-10 letters or digits, starting with a letter.'),
});

function RenameForm({
  org,
  projectKey,
  onDone,
}: {
  org: string;
  projectKey: string;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const rename = useRenameProjectKey(org, projectKey);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { key: projectKey },
  });
  const typedKey = useWatch({ control: form.control, name: 'key' });
  const onSubmit = form.handleSubmit(async ({ key }) => {
    const next = key.toUpperCase();
    if (next === projectKey) {
      onDone();
      return;
    }
    try {
      await rename.mutateAsync(next);
      onDone();
      void navigate(`/o/${org}/p/${next}?tab=details`, { replace: true });
    } catch (error) {
      applyServerErrors(error, ['key'], form.setError);
    }
  });
  const failure =
    rename.error && !(rename.error instanceof ApiError && [409, 422].includes(rename.error.status))
      ? describeError(rename.error)
      : null;
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-md space-y-3">
      <FormError>{failure}</FormError>
      <TextField
        label="New project key"
        autoComplete="off"
        error={form.formState.errors.key?.message}
        {...form.register('key')}
      />
      <p className="text-sm text-fg-muted">
        Every issue key in this project changes (for example {projectKey}-12 becomes{' '}
        {typedKey.toUpperCase() || 'NEW'}-12). Old keys and links keep working, and the old key can
        never be used by another project.
      </p>
      <div className="flex gap-2">
        <SubmitButton pending={rename.isPending}>Rename key</SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** Org owners/admins can change the key; everyone else sees nothing here. */
export function ProjectKeyRename({
  org,
  projectKey,
  archived,
}: {
  org: string;
  projectKey: string;
  archived: boolean;
}) {
  const orgQuery = useOrg(org);
  const [open, setOpen] = useState(false);
  if (!orgQuery.data?.permissions.includes('org.manage')) return null;
  if (open) {
    return (
      <RenameForm
        org={org}
        projectKey={projectKey}
        onDone={() => {
          setOpen(false);
        }}
      />
    );
  }
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      disabled={archived}
      onClick={() => {
        setOpen(true);
      }}
    >
      Change project key
    </Button>
  );
}
