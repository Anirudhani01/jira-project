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
import { useSignup } from '../api';

// Mirrors the server's limits for fast feedback; the server remains authoritative
// (it also rejects common, breached and personal passwords).
const schema = z.object({
  display_name: z.string().trim().min(1, 'Enter your name.').max(100),
  email: z.email('Enter a valid email address.').max(254),
  password: z
    .string()
    .min(12, 'Use at least 12 characters.')
    .max(128, 'Use at most 128 characters.'),
});
type Values = z.infer<typeof schema>;

const FIELD_ORDER = ['display_name', 'email', 'password'] as const;

/**
 * The response is identical whether or not the email already has an account (plan R2),
 * so the confirmation copy must be true in every case: a new or unverified address gets a
 * verification link, an already registered one gets a notice instead. It must also not
 * claim an email was sent: per-address limits and (outside production) disabled delivery
 * can mean nothing is sent.
 */
export const SIGNUP_ACCEPTED_MESSAGE =
  'Request received. If we can email that address, you will receive a message with the next step.';

export function SignupPage() {
  const signup = useSignup();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signup.mutateAsync(values);
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

  if (signup.isSuccess) {
    return (
      <AuthLayout>
        <section aria-labelledby="signup-done" className="space-y-4">
          <h1 id="signup-done" className="text-2xl font-semibold text-fg">
            Check your email
          </h1>
          <p role="status" className="text-fg-muted">
            {SIGNUP_ACCEPTED_MESSAGE}
          </p>
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link to="/login">Continue to sign in</Link>
          </Button>
        </section>
      </AuthLayout>
    );
  }

  const failure =
    signup.error && !(signup.error instanceof ApiError && signup.error.status === 422)
      ? describeError(signup.error)
      : null;

  return (
    <AuthLayout>
      <section aria-labelledby="signup-title" className="space-y-6">
        <h1 id="signup-title" className="text-2xl font-semibold text-fg">
          Create an account
        </h1>
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
          <FormError>{failure}</FormError>
          <TextField
            label="Name"
            autoComplete="name"
            error={errors.display_name?.message}
            {...form.register('display_name')}
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            error={errors.email?.message}
            {...form.register('email')}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            showStrength
            hint="At least 12 characters. Common or breached passwords are rejected."
            error={errors.password?.message}
            {...form.register('password')}
          />
          <SubmitButton pending={signup.isPending}>Create account</SubmitButton>
        </form>
        <p className="text-sm text-fg-muted">
          Already have an account?{' '}
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link to="/login">Sign in</Link>
          </Button>
        </p>
      </section>
    </AuthLayout>
  );
}
