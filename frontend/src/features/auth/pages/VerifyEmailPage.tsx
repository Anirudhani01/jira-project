import { Link } from 'react-router';

import { FormError, SubmitButton } from '../../../components/ui/Form';
import { ApiError } from '../../../lib/api/errors';
import { describeError } from '../../../lib/forms';
import { useSession, useVerifyEmail } from '../api';
import { useFragmentToken } from '../useFragmentToken';

export const INVALID_LINK_MESSAGE =
  'This link is invalid, has expired or was already used. To get a new verification link, sign up again with the same email address.';

/**
 * Verification needs one click: link scanners that open emails never verify by visiting.
 * The session is loaded first so a signed-in owner's request carries its CSRF token.
 */
export function VerifyEmailPage() {
  const token = useFragmentToken();
  const session = useSession();
  const verify = useVerifyEmail();

  if (verify.isSuccess) {
    return (
      <section aria-labelledby="verify-done" className="mx-auto max-w-sm space-y-4">
        <h1 id="verify-done" className="text-2xl font-semibold">
          Email verified
        </h1>
        <p role="status">
          Your email address is verified. For your security, any other signed-in sessions were
          signed out.
        </p>
        <Link to={session.data ? '/account' : '/login'} className="text-blue-700 underline">
          {session.data ? 'Go to your account' : 'Continue to sign in'}
        </Link>
      </section>
    );
  }

  const failure =
    !token || (verify.error instanceof ApiError && verify.error.status === 400)
      ? INVALID_LINK_MESSAGE
      : verify.error
        ? describeError(verify.error)
        : null;

  return (
    <section aria-labelledby="verify-title" className="mx-auto max-w-sm space-y-6">
      <h1 id="verify-title" className="text-2xl font-semibold">
        Verify your email address
      </h1>
      <FormError>{failure}</FormError>
      {token ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            verify.mutate({ token });
          }}
        >
          <SubmitButton pending={verify.isPending || session.isPending}>
            Verify email address
          </SubmitButton>
        </form>
      ) : null}
    </section>
  );
}
