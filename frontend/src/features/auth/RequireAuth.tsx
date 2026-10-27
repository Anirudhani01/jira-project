import { Navigate, Outlet, useLocation } from 'react-router';

import { ErrorState, LoadingState } from '../../components/ui/States';

import { useSession } from './api';

/**
 * UX guard only: the server enforces authentication on every request.
 * Signed-out users are sent to /login with a `next` path to come back to.
 */
export function RequireAuth() {
  const session = useSession();
  const location = useLocation();

  if (session.isPending) return <LoadingState label="Checking your session" />;
  if (session.isError)
    return <ErrorState error={session.error} onRetry={() => void session.refetch()} />;
  if (!session.data) {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}
