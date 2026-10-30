import type { QueryClient } from '@tanstack/react-query';

import { sessionKey } from '../../features/auth/api';

export type CsrfRefreshResult = { ok: true } | { ok: false; message: string };

let csrfRefreshInFlight: Promise<CsrfRefreshResult> | null = null;

export function isCsrfRefreshInProgress(): boolean {
  return csrfRefreshInFlight !== null;
}

/** Single-flight session refetch to obtain a new CSRF token. Does not replay mutations. */
export async function refreshSessionCsrf(queryClient: QueryClient): Promise<CsrfRefreshResult> {
  if (csrfRefreshInFlight) return csrfRefreshInFlight;

  csrfRefreshInFlight = (async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: sessionKey });
      await queryClient.refetchQueries({ queryKey: sessionKey, type: 'active' });
      const session = queryClient.getQueryData(sessionKey);
      if (session == null) {
        return {
          ok: false,
          message: 'Your session could not be refreshed. Sign in again, then retry your action.',
        };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        message: 'Could not refresh your session token. Try again or sign in again.',
      };
    } finally {
      csrfRefreshInFlight = null;
      const { flushPendingSessionExpiryAfterCsrf } = await import('./sessionExpiryController');
      flushPendingSessionExpiryAfterCsrf();
    }
  })();

  return csrfRefreshInFlight;
}

/** Test helper */
export function resetCsrfRefreshForTests(): void {
  csrfRefreshInFlight = null;
}
