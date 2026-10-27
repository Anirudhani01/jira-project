import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router';
import { z } from 'zod';

import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { applyServerErrors, describeError } from '../../../lib/forms';
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
      <section aria-labelledby="new-org-title" className="mx-auto max-w-sm space-y-4">
        <h1 id="new-org-title" className="text-2xl font-semibold">
          Create an organization
        </h1>
        <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          {VERIFY_FIRST_MESSAGE}
        </p>
      </section>
    );
  }

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const org = await create.mutateAsync(values);
      rememberOrg(org.slug);
      await navigate(`/o/${org.slug}`);
    } catch (error) {
      applyServerErrors(error, ['name', 'slug'], form.setError);
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
    <section aria-labelledby="new-org-title" className="mx-auto max-w-sm space-y-6">
      <h1 id="new-org-title" className="text-2xl font-semibold">
        Create an organization
      </h1>
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
    </section>
  );
}
