import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { FormError, SubmitButton, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { applyServerErrors, describeError } from '../../../lib/forms';
import { AuthLayout } from '../AuthLayout';
import { useLogin, useSession } from '../api';
import { safeNext } from '../safeNext';

const schema = z.object({
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(128),
});
type Values = z.infer<typeof schema>;

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const navigate = useNavigate();
  const session = useSession();
  const login = useLogin();
  const form = useForm<Values>({ resolver: zodResolver(schema) });
  const { errors } = form.formState;

  if (session.data) return <Navigate to={next} replace />;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      await navigate(next, { replace: true });
    } catch (error) {
      applyServerErrors(error, ['email', 'password'], form.setError);
    }
  });

  const failure =
    login.error instanceof ApiError && login.error.status === 401
      ? 'Email or password is incorrect.'
      : login.error && !(login.error instanceof ApiError && login.error.status === 422)
        ? describeError(login.error)
        : null;

  return (
    <AuthLayout>
      <section aria-labelledby="login-title" className="space-y-6">
        <div className="space-y-1">
          <h1 id="login-title" className="text-2xl font-semibold text-fg">
            Sign in
          </h1>
          <p className="text-sm text-fg-muted">Use the email and password for your account.</p>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-4">
          <FormError>{failure}</FormError>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            error={errors.email?.message}
            {...form.register('email')}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...form.register('password')}
          />
          <SubmitButton pending={login.isPending}>Sign in</SubmitButton>
        </form>
        <p className="text-sm text-fg-muted">
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link to="/forgot-password">Forgot password?</Link>
          </Button>
        </p>
        <p className="text-sm text-fg-muted">
          No account?{' '}
          <Button variant="link" size="sm" className="h-auto p-0" asChild>
            <Link to="/signup">Create one</Link>
          </Button>
        </p>
      </section>
    </AuthLayout>
  );
}
