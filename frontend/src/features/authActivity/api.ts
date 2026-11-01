import { useInfiniteQuery } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { AuthenticationActivityList } from '../../lib/api/types';

export interface AuthActivityFilters {
  member?: string;
  event_type?: string;
  from?: string;
  to?: string;
}

export function authActivityQueryKey(org: string, filters: AuthActivityFilters) {
  return ['org', org.toLowerCase(), 'authentication-activity', filters] as const;
}

/** Owner/admin authentication activity, newest first, cursor-paginated (A3.2 Phase 4). */
export function useAuthenticationActivity(
  org: string,
  filters: AuthActivityFilters,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: authActivityQueryKey(org, filters),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
      if (pageParam) params.set('cursor', pageParam);
      const query = params.toString();
      return apiFetch<AuthenticationActivityList>(
        `/orgs/${encodeURIComponent(org)}/authentication-activity${query ? `?${query}` : ''}`,
      );
    },
    getNextPageParam: (last) => last.next_cursor,
  });
}
