import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { describeError } from '../../../lib/forms';
import { applyServerErrorsWithFocus } from '../../../lib/ux/formFocus';
import { AuthLayout } from '../AuthLayout';
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

const FIELD_ORDER = ['new_password', 'confirm_password'] as const;
const ALLOWED_SERVER_FIELDS = ['new_password'] as const;

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
      applyServerErrorsWithFocus(
        error,
        FIELD_ORDER,
        ALLOWED_SERVER_FIELDS,
        form.setError,
        form.control,
        form.setFocus,
      );
    }
  });

  if (confirm.isSuccess) {
    return (
      <AuthLayout>
        <section aria-labelledby="reset-done" className="space-y-4">
          <h1 id="reset-done" className="text-2xl font-semibold text-fg">
            Password changed
          </h1>
          <p role="status" className="text-fg-muted">
            Your password was changed and you were signed out everywhere. Sign in with your new
            password.
          </p>
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link to="/login">Continue to sign in</Link>
          </Button>
        </section>
      </AuthLayout>
    );
  }

  const invalidLink = !token || (confirm.error instanceof ApiError && confirm.error.status === 400);
  const failure = invalidLink
    ? null
    : confirm.error && !(confirm.error instanceof ApiError && confirm.error.status === 422)
      ? describeError(confirm.error)
      : null;

  return (
    <AuthLayout>
      <section aria-labelledby="reset-title" className="space-y-6">
        <h1 id="reset-title" className="text-2xl font-semibold text-fg">
          Choose a new password
        </h1>
        {invalidLink ? (
          <div className="space-y-3">
            <FormError>{INVALID_RESET_LINK_MESSAGE}</FormError>
            <Button variant="link" size="sm" className="h-auto p-0" asChild>
              <Link to="/forgot-password">Request a new link</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
            <FormError>{failure}</FormError>
            <TextField
              label="New password"
              type="password"
              autoComplete="new-password"
              showStrength
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
    </AuthLayout>
  );
}
