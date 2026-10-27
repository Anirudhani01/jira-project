import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router';
import { z } from 'zod';

import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { applyServerErrors, describeError } from '../../../lib/forms';
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

/**
 * The response is identical whether or not the email already has an account (plan R2),
 * so the confirmation copy must be true in every case.
 */
export const SIGNUP_ACCEPTED_MESSAGE =
  'Request received. If you can sign in with these credentials, continue to sign in.';

export function SignupPage() {
  const signup = useSignup();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await signup.mutateAsync(values);
    } catch (error) {
      applyServerErrors(error, ['display_name', 'email', 'password'], form.setError);
    }
  });

  if (signup.isSuccess) {
    return (
      <section aria-labelledby="signup-done" className="mx-auto max-w-sm space-y-4">
        <h1 id="signup-done" className="text-2xl font-semibold">
          Check your details
        </h1>
        <p role="status">{SIGNUP_ACCEPTED_MESSAGE}</p>
        <Link to="/login" className="text-blue-700 underline">
          Continue to sign in
        </Link>
      </section>
    );
  }

  const failure =
    signup.error && !(signup.error instanceof ApiError && signup.error.status === 422)
      ? describeError(signup.error)
      : null;

  return (
    <section aria-labelledby="signup-title" className="mx-auto max-w-sm space-y-6">
      <h1 id="signup-title" className="text-2xl font-semibold">
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
          hint="At least 12 characters. Common or breached passwords are rejected."
          error={errors.password?.message}
          {...form.register('password')}
        />
        <SubmitButton pending={signup.isPending}>Create account</SubmitButton>
      </form>
      <p className="text-sm text-slate-600">
        Already have an account?{' '}
        <Link to="/login" className="text-blue-700 underline">
          Sign in
        </Link>
      </p>
    </section>
  );
}
