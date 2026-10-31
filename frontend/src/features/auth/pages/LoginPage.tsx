import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { z } from 'zod';

import { Button } from '../../../components/ui/Button';
import { FormError, TextField } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { describeError } from '../../../lib/forms';
import { applyServerErrorsWithFocus } from '../../../lib/ux/formFocus';
import { AuthLayout } from '../AuthLayout';
import { authEyebrowClass, authFieldClass, authSubmitClass } from '../authUi';
import { useLogin, useSession } from '../api';
import { safeNext } from '../safeNext';

const schema = z.object({
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(1, 'Enter your password.').max(128),
});
type Values = z.infer<typeof schema>;

const FIELD_ORDER = ['email', 'password'] as const;

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
    login.error instanceof ApiError && login.error.status === 401
      ? 'Email or password is incorrect.'
      : login.error && !(login.error instanceof ApiError && login.error.status === 422)
        ? describeError(login.error)
        : null;

  return (
    <AuthLayout>
      <section
        aria-labelledby="login-title"
        className="mx-auto w-full max-w-[400px] space-y-8 py-4 lg:py-0"
      >
        <div className="space-y-3">
          <p className={authEyebrowClass}>Welcome back</p>
          <h1
            id="login-title"
            className="text-[1.75rem] font-bold leading-tight tracking-tight text-fg xl:text-[2rem]"
          >
            Sign in to your workspace
          </h1>
          <p className="text-[15px] leading-relaxed text-fg-muted">
            Use your email and password to access your account.
          </p>
        </div>
        <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-5">
          <FormError>{failure}</FormError>
          <TextField
            label="Email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            className={authFieldClass}
            error={errors.email?.message}
            {...form.register('email')}
          />
          <TextField
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            className={authFieldClass}
            error={errors.password?.message}
            {...form.register('password')}
          />
          <Button
            type="submit"
            disabled={login.isPending}
            aria-busy={login.isPending}
            className={authSubmitClass}
          >
            Sign in
          </Button>
        </form>
        <p className="text-center text-sm">
          <Link to="/forgot-password" className="font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </p>
        <div className="flex items-center gap-3 text-xs font-medium uppercase tracking-wide text-fg-subtle">
          <span className="h-px flex-1 bg-line" aria-hidden="true" />
          <span>OR</span>
          <span className="h-px flex-1 bg-line" aria-hidden="true" />
        </div>
        <p className="text-center text-sm text-fg-muted">
          No account?{' '}
          <Link to="/signup" className="font-semibold text-accent hover:underline">
            Create one
          </Link>
        </p>
      </section>
    </AuthLayout>
  );
}
