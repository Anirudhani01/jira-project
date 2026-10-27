import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { FormError, SubmitButton, TextField } from '../../components/ui/Form';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { ApiError } from '../../lib/api/errors';
import type { SessionListItem } from '../../lib/api/types';
import { applyServerErrors, describeError } from '../../lib/forms';
import {
  useChangePassword,
  useRevokeOtherSessions,
  useRevokeSession,
  useSession,
  useSessions,
  useUpdateProfile,
} from '../auth/api';

const profileSchema = z.object({ display_name: z.string().trim().min(1).max(100) });
const passwordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.').max(128),
    new_password: z.string().min(12, 'Use at least 12 characters.').max(128),
    confirm_password: z.string(),
  })
  .refine((v) => v.new_password === v.confirm_password, {
    path: ['confirm_password'],
    message: 'Passwords do not match.',
  });

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function nonFieldError(error: unknown): string | null {
  if (!error || (error instanceof ApiError && error.status === 422)) return null;
  return describeError(error);
}

function ProfileForm({ displayName, email }: { displayName: string; email: string }) {
  const update = useUpdateProfile();
  const form = useForm<z.infer<typeof profileSchema>>({
    resolver: zodResolver(profileSchema),
    defaultValues: { display_name: displayName },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await update.mutateAsync(values);
    } catch (error) {
      applyServerErrors(error, ['display_name'], form.setError);
    }
  });
  return (
    <section aria-labelledby="profile-title" className="space-y-4">
      <h2 id="profile-title" className="text-lg font-semibold">
        Profile
      </h2>
      <p className="text-sm text-slate-600">Signed in as {email}</p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-sm space-y-3">
        <FormError>{nonFieldError(update.error)}</FormError>
        {update.isSuccess ? <p role="status">Profile saved.</p> : null}
        <TextField
          label="Name"
          error={form.formState.errors.display_name?.message}
          {...form.register('display_name')}
        />
        <SubmitButton pending={update.isPending}>Save</SubmitButton>
      </form>
    </section>
  );
}

function PasswordForm() {
  const change = useChangePassword();
  const form = useForm<z.infer<typeof passwordSchema>>({ resolver: zodResolver(passwordSchema) });
  const { errors } = form.formState;
  const onSubmit = form.handleSubmit(async ({ current_password, new_password }) => {
    try {
      await change.mutateAsync({ current_password, new_password });
      form.reset();
    } catch (error) {
      applyServerErrors(error, ['current_password', 'new_password'], form.setError);
    }
  });
  return (
    <section aria-labelledby="password-title" className="space-y-4">
      <h2 id="password-title" className="text-lg font-semibold">
        Change password
      </h2>
      <p className="text-sm text-slate-600">
        Changing your password signs you out on all other devices.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="max-w-sm space-y-3">
        <FormError>{nonFieldError(change.error)}</FormError>
        {change.isSuccess ? <p role="status">Password changed.</p> : null}
        <TextField
          label="Current password"
          type="password"
          autoComplete="current-password"
          error={errors.current_password?.message}
          {...form.register('current_password')}
        />
        <TextField
          label="New password"
          type="password"
          autoComplete="new-password"
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
        <SubmitButton pending={change.isPending}>Change password</SubmitButton>
      </form>
    </section>
  );
}

function SessionRow({ item }: { item: SessionListItem }) {
  const revoke = useRevokeSession();
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="text-sm">
        <p className="font-medium">
          {item.user_agent ?? 'Unknown device'}
          {item.current ? <span className="ml-2 text-green-700">(this device)</span> : null}
        </p>
        <p className="text-slate-600">
          Last active {dateFormat.format(new Date(item.last_seen_at))}
          {item.ip ? ` · ${item.ip}` : ''}
        </p>
      </div>
      {item.current ? null : (
        <button
          type="button"
          onClick={() => {
            revoke.mutate(item.id);
          }}
          disabled={revoke.isPending}
          className="text-sm text-red-700 underline disabled:opacity-60"
          aria-label={`Sign out session from ${item.user_agent ?? 'unknown device'}`}
        >
          Sign out
        </button>
      )}
    </li>
  );
}

function SessionsSection() {
  const sessions = useSessions();
  const revokeOthers = useRevokeOtherSessions();
  if (sessions.isPending) return <LoadingState label="Loading sessions" />;
  if (sessions.isError) {
    return <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />;
  }
  const hasOthers = sessions.data.items.some((s) => !s.current);
  return (
    <section aria-labelledby="sessions-title" className="space-y-3">
      <h2 id="sessions-title" className="text-lg font-semibold">
        Active sessions
      </h2>
      <ul className="divide-y divide-slate-200">
        {sessions.data.items.map((item) => (
          <SessionRow key={item.id} item={item} />
        ))}
      </ul>
      {hasOthers ? (
        <button
          type="button"
          onClick={() => {
            revokeOthers.mutate();
          }}
          disabled={revokeOthers.isPending}
          className="text-sm text-red-700 underline disabled:opacity-60"
        >
          Sign out all other sessions
        </button>
      ) : null}
    </section>
  );
}

export function AccountPage() {
  const session = useSession();
  if (!session.data) return null; // RequireAuth renders loading/redirect states
  const { user } = session.data;
  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Account</h1>
      {user.email_verified ? null : (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Your email address is not verified yet. Open the verification link we emailed you. To get
          a new link, sign up again with the same email address.
        </p>
      )}
      <ProfileForm displayName={user.display_name} email={user.email} />
      <PasswordForm />
      <SessionsSection />
    </div>
  );
}
