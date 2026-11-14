import { keepPreviousData, useQuery } from '@tanstack/react-query';

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

export const AUTH_ACTIVITY_PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_AUTH_ACTIVITY_PAGE_SIZE = 25;

export interface AuthActivityPageRequest {
  /** Cursor of the page to load; `null` for the first page. */
  cursor: string | null;
  limit: number;
}

/** One page of owner/admin authentication activity, newest first. The API is cursor-based
 * (`next_cursor`, no total), so the page controls keep the cursors of the pages already seen. */
export function useAuthenticationActivityPage(
  org: string,
  filters: AuthActivityFilters,
  page: AuthActivityPageRequest,
  enabled = true,
) {
  return useQuery({
    queryKey: [...authActivityQueryKey(org, filters), 'page', page.limit, page.cursor] as const,
    enabled,
    // Keep the rows on screen while the next page loads, so the table does not flash empty.
    placeholderData: keepPreviousData,
    queryFn: () => {
      const params = new URLSearchParams(
        Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
      params.set('limit', String(page.limit));
      if (page.cursor) params.set('cursor', page.cursor);
      return apiFetch<AuthenticationActivityList>(
        `/orgs/${encodeURIComponent(org)}/authentication-activity?${params.toString()}`,
      );
    },
  });
}
