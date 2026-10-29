import { Link } from 'react-router';

import { Button } from '../../../components/ui/Button';
import { FormError, SubmitButton } from '../../../components/ui/Form';
import { SimpleFormPage } from '../../../components/ui/SimpleFormPage';
import { LoadingState } from '../../../components/ui/States';
import { ApiError } from '../../../lib/api/errors';
import { describeError } from '../../../lib/forms';
import { AuthLayout } from '../../auth/AuthLayout';
import { useSession } from '../../auth/api';
import { useFragmentToken } from '../../auth/useFragmentToken';
import { rememberOrg, useAcceptInvitation } from '../api';

const MESSAGES: Record<string, string> = {
  invitation_unavailable: 'This invitation has expired, was revoked or was already used.',
  not_found: 'This invitation link is not valid.',
  email_unverified: 'Verify your email address first, then open the invitation link again.',
  invitation_email_mismatch:
    'This invitation was sent to a different email address. Sign in with that address.',
  already_member: 'You are already a member of this organization.',
};

const PENDING_KEY = 'jira.pendingInvitation';

/** Keeps the token across the sign-in round trip in this tab only (never in a URL query). */
function usePendingToken(): string | null {
  const fromFragment = useFragmentToken();
  let token = fromFragment;
  try {
    if (fromFragment) sessionStorage.setItem(PENDING_KEY, fromFragment);
    else token = sessionStorage.getItem(PENDING_KEY);
  } catch {
    // Storage unavailable: the fragment token still works if already signed in.
  }
  return token;
}

function forgetPendingToken(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // ignore
  }
}

/** Joins only on an explicit click; signed-out visitors are asked to sign in first. */
export function AcceptInvitationPage() {
  const token = usePendingToken();
  const session = useSession();
  const acceptInvitation = useAcceptInvitation();

  if (session.isPending) return <LoadingState label="Checking your session" />;

  if (!session.data) {
    return (
      <AuthLayout>
        <section aria-labelledby="accept-title" className="space-y-4">
          <h1 id="accept-title" className="text-2xl font-semibold text-fg">
            Join organization
          </h1>
          <p className="text-fg-muted">
            Sign in with the email address the invitation was sent to, then accept it here.
          </p>
          <Button variant="primary" asChild>
            <Link to={`/login?next=${encodeURIComponent('/invitations/accept')}`}>
              Sign in to accept
            </Link>
          </Button>
        </section>
      </AuthLayout>
    );
  }

  if (acceptInvitation.isSuccess) {
    const joined = acceptInvitation.data;
    rememberOrg(joined.slug);
    forgetPendingToken();
    return (
      <SimpleFormPage title={`Welcome to ${joined.name}`} titleId="joined-title">
        <Button variant="primary" asChild>
          <Link to={`/o/${joined.slug}`}>Open {joined.name}</Link>
        </Button>
      </SimpleFormPage>
    );
  }

  const error = acceptInvitation.error;
  const failure = !token
    ? MESSAGES.not_found
    : error instanceof ApiError && error.code in MESSAGES
      ? MESSAGES[error.code]
      : error
        ? describeError(error)
        : null;

  return (
    <SimpleFormPage title="Join organization" titleId="accept-title">
      <FormError>{failure}</FormError>
      {token ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            acceptInvitation.mutate(token);
          }}
        >
          <SubmitButton pending={acceptInvitation.isPending}>Accept invitation</SubmitButton>
        </form>
      ) : null}
    </SimpleFormPage>
  );
}
