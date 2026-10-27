import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';

import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { applyServerErrors, describeError } from '../../../lib/forms';
import { useConfirmPasswordReset } from '../api';
import { useFragmentToken } from '../useFragmentToken';

const schema = z
  .object({
    new_password: z
      .string()
      .min(12, 'Use at least 12 characters.')
      .max(128, 'Use at most 128 characters.'),
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match.',
  });
type Values = z.infer<typeof schema>;

export const INVALID_RESET_LINK_MESSAGE =
  'This link is invalid, has expired or was already used. Request a new one.';

export function ResetPasswordPage() {
  const token = useFragmentToken();
  const confirm = useConfirmPasswordReset();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async ({ new_password }) => {
    if (!token) return;
    try {
      await confirm.mutateAsync({ token, new_password });
    } catch (error) {
      applyServerErrors(error, ['new_password'], form.setError);
    }
  });

  if (confirm.isSuccess) {
    return (
      <section aria-labelledby="reset-done" className="mx-auto max-w-sm space-y-4">
        <h1 id="reset-done" className="text-2xl font-semibold">
          Password changed
        </h1>
        <p role="status">
          Your password was changed and you were signed out everywhere. Sign in with your new
          password.
        </p>
        <Link to="/login" className="text-blue-700 underline">
          Continue to sign in
        </Link>
      </section>
    );
  }

  const invalidLink = !token || (confirm.error instanceof ApiError && confirm.error.status === 400);
  const failure = invalidLink
    ? null
    : confirm.error && !(confirm.error instanceof ApiError && confirm.error.status === 422)
      ? describeError(confirm.error)
      : null;

  return (
    <section aria-labelledby="reset-title" className="mx-auto max-w-sm space-y-6">
      <h1 id="reset-title" className="text-2xl font-semibold">
        Choose a new password
      </h1>
      {invalidLink ? (
        <div className="space-y-3">
          <FormError>{INVALID_RESET_LINK_MESSAGE}</FormError>
          <Link to="/forgot-password" className="text-blue-700 underline">
            Request a new link
          </Link>
        </div>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
          <FormError>{failure}</FormError>
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            hint="At least 12 characters. Common or breached passwords are rejected."
            error={errors.new_password?.message}
            {...form.register('new_password')}
          />
          <TextField
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirm_password?.message}
            {...form.register('confirm_password')}
          />
          <SubmitButton pending={confirm.isPending}>Change password</SubmitButton>
        </form>
      )}
    </section>
  );
}
