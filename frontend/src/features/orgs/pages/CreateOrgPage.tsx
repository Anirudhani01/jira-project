import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { SimpleFormPage } from '../../../components/ui/SimpleFormPage';
import { ApiError } from '../../../lib/api/errors';
import { describeError } from '../../../lib/forms';
import { applyServerErrorsWithFocus } from '../../../lib/ux/formFocus';
import { useSession } from '../../auth/api';
import { rememberOrg, useCreateOrg } from '../api';

// Mirrors the server's rules (plan V2.6); the server remains authoritative and also
// rejects reserved and taken addresses.
const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(100, 'Use at most 100 characters.'),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z0-9][a-z0-9-]{1,38}$/,
      'Use 2–39 lowercase letters, digits or hyphens, starting with a letter or digit.',
    ),
});
type Values = z.infer<typeof schema>;

const FIELD_ORDER = ['name', 'slug'] as const;

export const VERIFY_FIRST_MESSAGE =
  'Verify your email address before creating an organization. Open the verification link we emailed you.';

export function CreateOrgPage() {
  const session = useSession();
  const create = useCreateOrg();
  const navigate = useNavigate();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors } = form.formState;

  if (session.data && !session.data.user.email_verified) {
    return (
      <SimpleFormPage title="Create an organization" titleId="new-org-title">
        <p
          role="status"
          className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"
        >
          {VERIFY_FIRST_MESSAGE}
        </p>
      </SimpleFormPage>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const org = await create.mutateAsync(values);
      rememberOrg(org.slug);
      await navigate(`/o/${org.slug}`);
    } catch (error) {
      applyServerErrorsWithFocus(
        error,
        FIELD_ORDER,
        FIELD_ORDER,
        form.setError,
        form.control,
        form.setFocus,
      );
    }
  });

  const failure =
    create.error instanceof ApiError && create.error.code === 'email_unverified'
      ? VERIFY_FIRST_MESSAGE
      : create.error &&
          !(create.error instanceof ApiError && [409, 422].includes(create.error.status))
        ? describeError(create.error)
        : null;

  return (
    <SimpleFormPage title="Create an organization" titleId="new-org-title">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
        <FormError>{failure}</FormError>
        <TextField label="Name" error={errors.name?.message} {...form.register('name')} />
        <TextField
          label="Address"
          hint="Used in links, e.g. /o/acme. It cannot be changed later."
          autoCapitalize="none"
          spellCheck={false}
          error={errors.slug?.message}
          {...form.register('slug')}
        />
        <SubmitButton pending={create.isPending}>Create organization</SubmitButton>
      </form>
    </SimpleFormPage>
  );
}
