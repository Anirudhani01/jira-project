import {
  MutationCache,
  QueryCache,
  QueryClient,
  type Mutation,
  type Query,
} from '@tanstack/react-query';

import { ApiError } from './api/errors';
import { dispatchMutationError, dispatchQueryError } from './ux/cacheErrorDispatch';

const MAX_QUERY_RETRIES = 3;

/** Retry reads only for transient failures; never retry client errors (4xx). */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false;
  return error instanceof ApiError ? error.isTransient : false;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        dispatchQueryError(error, query as Query);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        dispatchMutationError(error, mutation as Mutation);
      },
    }),
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
      },
      // Mutations are never retried automatically (plan R5): the user decides.
      mutations: { retry: false },
    },
  });
}
