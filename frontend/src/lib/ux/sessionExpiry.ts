import type { Mutation } from '@tanstack/react-query';

import { ApiError } from '../api/errors';

const SESSION_QUERY_KEY = ['auth', 'session'] as const;

export function isCsrfRecoveryError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403 && error.code === 'csrf_failed';
}

export function isSessionUnauthenticatedError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === 'unauthenticated';
}

export function shouldSkipSessionExpiryForQuery(queryKey: readonly unknown[]): boolean {
  return (
    queryKey.length >= 2 &&
    queryKey[0] === SESSION_QUERY_KEY[0] &&
    queryKey[1] === SESSION_QUERY_KEY[1]
  );
}

export function shouldSkipSessionExpiryForMutation(mutation: Mutation): boolean {
  const meta = mutation.meta as { uxAuthSurface?: string } | undefined;
  return meta?.uxAuthSurface === 'login';
}
