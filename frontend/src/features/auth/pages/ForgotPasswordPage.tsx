import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { applyServerErrors, describeError } from '../../../lib/forms';
import { AuthLayout } from '../AuthLayout';
import { useRequestPasswordReset } from '../api';

const schema = z.object({ email: z.email('Enter a valid email address.').max(254) });
type Values = z.infer<typeof schema>;

/** The response is the same whether or not an account exists, so this copy must be too. */
export const RESET_REQUESTED_MESSAGE =
  'If an account exists for that address, we have sent it a link to reset the password. The link expires in 1 hour.';

export const EMAIL_UNAVAILABLE_MESSAGE =
  'Password reset by email is not available right now. Please try again later.';

export function ForgotPasswordPage() {
  const request = useRequestPasswordReset();
  const form = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await request.mutateAsync(values);
    } catch (error) {
      applyServerErrors(error, ['email'], form.setError);
    }
  });

  if (request.isSuccess) {
    return (
      <AuthLayout>
        <section aria-labelledby="forgot-done" className="space-y-4">
          <h1 id="forgot-done" className="text-2xl font-semibold text-fg">
            Check your email
          </h1>
          <p role="status" className="text-fg-muted">
            {RESET_REQUESTED_MESSAGE}
          </p>
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link to="/login">Back to sign in</Link>
          </Button>
        </section>
      </AuthLayout>
    );
  }

  // 503 email_unavailable is global (the same for every address): say so plainly instead
  // of pretending a link was sent.
  const failure =
    request.error instanceof ApiError && request.error.code === 'email_unavailable'
      ? EMAIL_UNAVAILABLE_MESSAGE
      : request.error && !(request.error instanceof ApiError && request.error.status === 422)
        ? describeError(request.error)
        : null;

  return (
    <AuthLayout>
      <section aria-labelledby="forgot-title" className="space-y-6">
        <h1 id="forgot-title" className="text-2xl font-semibold text-fg">
          Reset your password
        </h1>
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
          <FormError>{failure}</FormError>
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          <SubmitButton pending={request.isPending}>Send reset link</SubmitButton>
        </form>
      </section>
    </AuthLayout>
  );
}
