import { useInfiniteQuery } from '@tanstack/react-query';

import { apiFetch } from '../../lib/api/client';
import type { AuditEventList } from '../../lib/api/types';

export interface AuditFilters {
  action?: string;
  actor?: string;
  from?: string;
  to?: string;
}

/** Owner/admin audit log, newest first, cursor-paginated (plan §4.4). */
export function useAuditEvents(org: string, filters: AuditFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: ['org', org.toLowerCase(), 'audit', filters],
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(
        Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])),
      );
      if (pageParam) params.set('cursor', pageParam);
      const query = params.toString();
      return apiFetch<AuditEventList>(
        `/orgs/${encodeURIComponent(org)}/audit-events${query ? `?${query}` : ''}`,
      );
    },
    getNextPageParam: (last) => last.next_cursor,
  });
}
