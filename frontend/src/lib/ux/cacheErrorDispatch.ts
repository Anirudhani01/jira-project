import type { Mutation, Query } from '@tanstack/react-query';

import { isCsrfRefreshInProgress, refreshSessionCsrf } from './csrfRecovery';
import {
  isCsrfRecoveryError,
  isSessionUnauthenticatedError,
  shouldSkipSessionExpiryForMutation,
  shouldSkipSessionExpiryForQuery,
} from './sessionExpiry';
import { onSessionUnauthenticatedError } from './sessionExpiryController';

export type CacheErrorHandlers = {
  getNextPath: () => string;
  onCsrfRefreshFailed: (message: string) => void;
  onCsrfRefreshSucceeded: () => void;
  getQueryClient: () => import('@tanstack/react-query').QueryClient;
};

let handlers: CacheErrorHandlers | null = null;

export function setCacheErrorHandlers(next: CacheErrorHandlers | null): void {
  handlers = next;
}

export function dispatchQueryError(error: unknown, query: Query): void {
  if (!handlers) return;
  if (shouldSkipSessionExpiryForQuery(query.queryKey)) return;
  if (isCsrfRecoveryError(error)) return;
  if (isSessionUnauthenticatedError(error)) {
    onSessionUnauthenticatedError(handlers.getNextPath());
  }
}

export function dispatchMutationError(error: unknown, mutation: Mutation): void {
  if (!handlers) return;
  if (shouldSkipSessionExpiryForMutation(mutation)) return;

  if (isCsrfRecoveryError(error)) {
    if (isCsrfRefreshInProgress()) return;
    void refreshSessionCsrf(handlers.getQueryClient()).then((result) => {
      if (result.ok) {
        handlers?.onCsrfRefreshSucceeded();
      } else {
        handlers?.onCsrfRefreshFailed(result.message);
      }
      // Pending session-expiry (if any) is flushed in refreshSessionCsrf finally.
    });
    return;
  }

  if (isSessionUnauthenticatedError(error)) {
    onSessionUnauthenticatedError(handlers.getNextPath());
  }
}
