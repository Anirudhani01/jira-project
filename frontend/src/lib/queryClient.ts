import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api/errors';

const MAX_QUERY_RETRIES = 3;

/** Retry reads only for transient failures; never retry client errors (4xx). */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  return error instanceof ApiError ? error.isTransient : false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      },
      // Mutations are never retried automatically (plan R5): the user decides.
      mutations: { retry: false },
    },
  });
}
